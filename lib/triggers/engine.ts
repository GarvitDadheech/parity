/**
 * The trigger engine — the heart of Parity.
 *
 * One tick: pull live prices, persist them, then walk every armed rule and
 * decide whether it fires. Two properties matter more than anything else here.
 *
 * **It must not spam.** A token sitting near a threshold would otherwise fire on
 * every poll. `AlertState.currentlyTriggered` latches a rule after it fires, and
 * it only re-arms once the gap has retreated past a hysteresis band (see
 * `ruleRearmed`), so a rule fires on the *crossing*, not on the condition.
 *
 * **It must not double-spend.** For a policy, the latch is the difference
 * between buying a dip once and buying it forty times. The check-and-set is done
 * as a conditional update — a single atomic statement — so two overlapping cron
 * invocations cannot both observe an un-fired rule and both proceed. Whichever
 * update reports a row wins; the other backs off.
 */

import { fetchPreStocks } from "@/lib/prestocks/client";
import { ruleRearmed, ruleTriggered } from "@/lib/prestocks/math";
import type { PreStock } from "@/lib/prestocks/types";
import { prisma } from "@/lib/db/client";
import {
  loadActiveRules,
  purgeExpiredPendingTrades,
  recordPrices,
} from "@/lib/db/repositories";
import { executeSwap, GuardrailError } from "@/lib/privy/execute";

export interface TickReport {
  ranAt: string;
  tokensPriced: number;
  alertsFired: number;
  policiesExecuted: number;
  rulesRearmed: number;
  skipped: string[];
  errors: string[];
}

/**
 * Notifications the tick produced. The engine does not talk to Telegram itself —
 * it returns what should be said, and the caller delivers it. That keeps the
 * engine testable without a bot token and keeps a Telegram outage from rolling
 * back a trade that really happened.
 */
export interface Outbox {
  chatId: bigint;
  text: string;
  kind: "alert" | "execution";
  symbol: string;
  /** Present on alerts so the message can carry a Buy button. */
  buyPrompt?: { symbol: string };
}

const LOCK_KEY = "poll";
const LOCK_TTL_MS = 55_000;

/**
 * Cooperative lock so overlapping ticks do not both run.
 *
 * The lock row carries an expiry rather than being a plain boolean, so a process
 * that dies mid-tick cannot wedge the poller permanently.
 */
async function acquireLock(holder: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);

  try {
    await prisma.systemLock.create({ data: { key: LOCK_KEY, holder, expiresAt } });
    return true;
  } catch {
    // A row exists. Take it over only if the previous holder's lease has lapsed.
    const { count } = await prisma.systemLock.updateMany({
      where: { key: LOCK_KEY, expiresAt: { lt: now } },
      data: { holder, expiresAt },
    });
    return count > 0;
  }
}

async function releaseLock(holder: string): Promise<void> {
  await prisma.systemLock.deleteMany({ where: { key: LOCK_KEY, holder } });
}

/**
 * Latch a rule as fired, but only if it was not already latched.
 *
 * Returns true to exactly one caller. This is the idempotency guarantee for
 * policies: the row is the permission to spend, and it is handed out once.
 */
async function claimTrigger(telegramId: bigint, symbol: string, ruleKey: string): Promise<boolean> {
  const now = new Date();

  // Ensure the state row exists without disturbing an existing latch.
  await prisma.alertState.upsert({
    where: { telegramId_symbol_ruleKey: { telegramId, symbol, ruleKey } },
    create: { telegramId, symbol, ruleKey, currentlyTriggered: false },
    update: {},
  });

  const { count } = await prisma.alertState.updateMany({
    where: { telegramId, symbol, ruleKey, currentlyTriggered: false },
    data: { currentlyTriggered: true, lastFiredAt: now },
  });

  return count === 1;
}

async function rearm(telegramId: bigint, symbol: string, ruleKey: string): Promise<boolean> {
  const { count } = await prisma.alertState.updateMany({
    where: { telegramId, symbol, ruleKey, currentlyTriggered: true },
    data: { currentlyTriggered: false },
  });
  return count === 1;
}

function formatGap(premium: number): string {
  const magnitude = Math.abs(premium).toFixed(1);
  return premium < 0 ? `${magnitude}% BELOW` : `${magnitude}% ABOVE`;
}

export async function runTick(options?: { holder?: string }): Promise<{ report: TickReport; outbox: Outbox[] }> {
  const holder = options?.holder ?? `tick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const report: TickReport = {
    ranAt: new Date().toISOString(),
    tokensPriced: 0,
    alertsFired: 0,
    policiesExecuted: 0,
    rulesRearmed: 0,
    skipped: [],
    errors: [],
  };
  const outbox: Outbox[] = [];

  if (!(await acquireLock(holder))) {
    report.skipped.push("Another tick is already running");
    return { report, outbox };
  }

  try {
    // Always read prices live. Nothing downstream may act on a cached gap.
    const tokens = await fetchPreStocks({ force: true });
    report.tokensPriced = tokens.length;

    await recordPrices(
      tokens.map((t) => ({
        symbol: t.symbol,
        markPrice: t.markPrice,
        tokenPrice: t.tokenPrice,
        premiumPct: t.premiumPct,
        mint: t.contract_address,
        name: t.name,
      })),
    );

    const bySymbol = new Map<string, PreStock>(tokens.map((t) => [t.symbol.toUpperCase(), t]));
    const { watches, policies } = await loadActiveRules();

    // ---- Alerts -----------------------------------------------------------
    for (const watch of watches) {
      const token = bySymbol.get(watch.symbol.toUpperCase());
      if (!token) continue;

      const direction = watch.direction === "premium" ? "premium" : "discount";
      const ruleKey = `watch:${watch.id}`;

      if (ruleTriggered(direction, watch.thresholdPct, token.premiumPct)) {
        if (await claimTrigger(watch.telegramId, watch.symbol, ruleKey)) {
          report.alertsFired += 1;
          outbox.push({
            chatId: watch.telegramId,
            kind: "alert",
            symbol: token.symbol,
            buyPrompt: { symbol: token.symbol },
            text:
              `${token.symbol} is ${formatGap(token.premiumPct)} fair value ` +
              `($${token.tokenPrice.toFixed(2)} vs $${token.markPrice.toFixed(2)} NAV).`,
          });
        }
      } else if (ruleRearmed(direction, watch.thresholdPct, token.premiumPct)) {
        if (await rearm(watch.telegramId, watch.symbol, ruleKey)) report.rulesRearmed += 1;
      }
    }

    // ---- Automated execution ---------------------------------------------
    for (const policy of policies) {
      const token = bySymbol.get(policy.symbol.toUpperCase());
      if (!token) continue;

      const direction = policy.kind === "autosell" ? "premium" : "discount";
      const ruleKey = `policy:${policy.id}`;

      if (!ruleTriggered(direction, policy.thresholdPct, token.premiumPct)) {
        if (ruleRearmed(direction, policy.thresholdPct, token.premiumPct)) {
          if (await rearm(policy.telegramId, policy.symbol, ruleKey)) report.rulesRearmed += 1;
        }
        continue;
      }

      // Check the kill switch before claiming, so a paused user's rules stay
      // armed and fire on the next crossing after they resume rather than
      // being silently consumed while paused.
      if (policy.user.paused || !policy.user.signerActive) continue;

      if (!(await claimTrigger(policy.telegramId, policy.symbol, ruleKey))) continue;

      try {
        const result = await executeSwap({
          user: policy.user,
          kind: policy.kind === "autosell" ? "auto_sell" : "auto_buy",
          symbol: token.symbol,
          mint: token.contract_address,
          usdcAmount: policy.amountUsdc ?? undefined,
          tokenAmount: policy.amountToken ?? undefined,
          sellAll: policy.kind === "autosell" && policy.amountToken == null,
          premiumAtExec: token.premiumPct,
        });

        report.policiesExecuted += 1;
        outbox.push({
          chatId: policy.telegramId,
          kind: "execution",
          symbol: token.symbol,
          text: result.message,
        });
      } catch (error) {
        // A guardrail refusal is a real answer, not a failure of the engine:
        // tell the user why nothing happened rather than swallowing it.
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof GuardrailError) {
          outbox.push({
            chatId: policy.telegramId,
            kind: "execution",
            symbol: token.symbol,
            text: `Auto-${policy.kind === "autosell" ? "sell" : "buy"} on ${token.symbol} was blocked: ${message}`,
          });
        } else {
          report.errors.push(`${ruleKey}: ${message}`);
        }
      }
    }

    await purgeExpiredPendingTrades();
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await releaseLock(holder);
  }

  return { report, outbox };
}
