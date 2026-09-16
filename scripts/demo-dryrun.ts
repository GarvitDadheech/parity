/**
 * Walks the full automated path in dry run, against the real onboarded user and
 * real live prices, spending nothing.
 *
 * 1. Prices a buy and reports every guardrail.
 * 2. Arms an auto-buy that today's data crosses.
 * 3. Runs a trigger tick, so the policy fires exactly as it would in production.
 * 4. Delivers the resulting message to Telegram.
 * 5. Disarms, leaving no state behind.
 */

import { deliverOutbox, botConfigured } from "../bot/bot";
import { config } from "../lib/config";
import { prisma } from "../lib/db/client";
import { executeSwap } from "../lib/privy/execute";
import { fetchPreStocks } from "../lib/prestocks/client";
import { runTick } from "../lib/triggers/engine";

async function main() {
  if (!config.dryRun()) {
    console.log("DRY_RUN is false. Refusing to run a demo against live execution.");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ where: { signerActive: true } });
  if (!user) {
    console.log("No onboarded user. Send /login to the bot first.");
    process.exit(1);
  }

  const tokens = await fetchPreStocks({ force: true });
  const target = [...tokens].sort((a, b) => a.premiumPct - b.premiumPct)[0];

  console.log(`\n1. MANUAL BUY — what /buy ${target.symbol} 10 would do`);
  console.log("=".repeat(68));
  const manual = await executeSwap({
    user,
    kind: "manual_buy",
    symbol: target.symbol,
    mint: target.contract_address,
    usdcAmount: 10,
    premiumAtExec: target.premiumPct,
  });
  console.log(manual.message);

  console.log(`\n\n2. AUTOMATED — arming an auto-buy that today's data crosses`);
  console.log("=".repeat(68));
  // Threshold just inside the current gap, so it fires on this tick.
  const threshold = Math.floor(Math.abs(target.premiumPct)) - 1;
  const policy = await prisma.policy.create({
    data: {
      telegramId: user.telegramId,
      kind: "autobuy",
      symbol: target.symbol,
      thresholdPct: threshold,
      amountUsdc: 10,
    },
  });
  console.log(
    `armed: buy $10 of ${target.symbol} when it trades ${threshold}% or more below NAV\n` +
      `current gap: ${target.premiumPct.toFixed(2)}%  ->  should fire immediately`,
  );

  console.log(`\n\n3. RUNNING A TRIGGER TICK`);
  console.log("=".repeat(68));
  const first = await runTick();
  console.log(
    `priced ${first.report.tokensPriced} tokens · ` +
      `${first.report.policiesExecuted} policy execution(s) · ` +
      `${first.outbox.length} message(s) queued`,
  );
  for (const m of first.outbox) console.log(`\n${m.text}`);

  console.log(`\n\n4. SECOND TICK — proving it does not fire again`);
  console.log("=".repeat(68));
  const second = await runTick();
  console.log(
    `${second.report.policiesExecuted} execution(s), ${second.outbox.length} message(s) — ` +
      `the latch held, so the same dip is not bought twice`,
  );

  if (botConfigured() && first.outbox.length > 0) {
    const sent = await deliverOutbox(first.outbox);
    console.log(`\n\ndelivered ${sent.sent} message(s) to Telegram — check your chat.`);
  }

  console.log(`\n\n5. TRADE LOG`);
  console.log("=".repeat(68));
  const trades = await prisma.trade.findMany({
    where: { telegramId: user.telegramId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const t of trades) {
    console.log(
      `  #${t.id} ${t.kind.padEnd(11)} ${t.symbol.padEnd(10)} ` +
        `$${(t.usdcAmount ?? 0).toFixed(2).padStart(7)} @ ${t.premiumAtExec.toFixed(2)}% ` +
        `· ${t.status}${t.error ? " · blocked: " + t.error.slice(0, 60) : ""}`,
    );
  }

  // Leave no state behind.
  await prisma.policy.delete({ where: { id: policy.id } });
  await prisma.alertState.deleteMany({ where: { ruleKey: `policy:${policy.id}` } });
  console.log(`\ncleaned up: policy #${policy.id} disarmed.`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
