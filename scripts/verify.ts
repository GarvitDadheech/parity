/**
 * End-to-end verification of the parts that are easy to get quietly wrong.
 *
 * Run with: npm run verify
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma";
import { fetchPreStocks } from "../lib/prestocks/client";
import {
  HYSTERESIS_PCT,
  premiumPct,
  ruleRearmed,
  ruleTriggered,
  verdictFor,
} from "../lib/prestocks/math";
import { getQuote } from "../lib/jupiter/client";
import { USDC_MINT } from "../lib/solana/connection";
import { rawToUi, uiToRaw } from "../lib/solana/mint";
import { runTick } from "../lib/triggers/engine";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

async function main() {
  // -------------------------------------------------------------------------
  section("1. Core math");

  check(
    "premium is negative for a discount",
    premiumPct({ markPrice: 100, tokenPrice: 80 }) === -20,
    `${premiumPct({ markPrice: 100, tokenPrice: 80 })}%`,
  );
  check(
    "premium is positive for a premium",
    premiumPct({ markPrice: 100, tokenPrice: 117 }) === 17,
  );
  check("a zero NAV cannot divide by zero", premiumPct({ markPrice: 0, tokenPrice: 10 }) === 0);

  check("-20% is a deep discount", verdictFor(-20) === "DEEP_DISCOUNT");
  check("-10% is exactly deep (boundary)", verdictFor(-10) === "DEEP_DISCOUNT");
  check("-3% is a discount (boundary)", verdictFor(-3) === "DISCOUNT");
  check("-2.9% is fair", verdictFor(-2.9) === "FAIR");
  check("+3% is a premium (boundary)", verdictFor(3) === "PREMIUM");
  check("+10% is a high premium (boundary)", verdictFor(10) === "HIGH_PREMIUM");

  // -------------------------------------------------------------------------
  section("2. Trigger + hysteresis");

  check("discount rule fires at threshold", ruleTriggered("discount", 15, -15));
  check("discount rule fires beyond threshold", ruleTriggered("discount", 15, -21));
  check("discount rule does not fire above threshold", !ruleTriggered("discount", 15, -14.9));
  check("premium rule fires at threshold", ruleTriggered("premium", 10, 10));
  check("premium rule does not fire below", !ruleTriggered("premium", 10, 9.9));

  check(
    `does not re-arm just inside the band (${HYSTERESIS_PCT}%)`,
    !ruleRearmed("discount", 15, -12.5),
    "at -12.5% with a 15% rule, band ends at -12%",
  );
  check("re-arms once the gap retreats past the band", ruleRearmed("discount", 15, -11.9));
  check("premium rule re-arms symmetrically", ruleRearmed("premium", 10, 6.9));
  check("premium rule does not re-arm inside band", !ruleRearmed("premium", 10, 7.5));

  // -------------------------------------------------------------------------
  section("3. Token-2022 scaled UI amounts");

  // SPACEX carries a scaled-UI multiplier of 5. Getting this wrong makes every
  // amount off by that factor, which is the single most expensive silent bug here.
  const scaled = { decimals: 9, uiMultiplier: 5 };
  const plain = { decimals: 9, uiMultiplier: 1 };

  check(
    "raw -> ui applies the multiplier",
    rawToUi(17_159_889n, scaled) === 0.085799445,
    `${rawToUi(17_159_889n, scaled)} tokens`,
  );
  check(
    "a naive conversion would be 5x too small",
    rawToUi(17_159_889n, plain) * 5 === rawToUi(17_159_889n, scaled),
  );
  check(
    "ui -> raw round-trips",
    Math.abs(rawToUi(uiToRaw(0.0858, scaled), scaled) - 0.0858) < 1e-9,
  );

  // -------------------------------------------------------------------------
  section("4. Live PreStocks feed");

  const tokens = await fetchPreStocks({ force: true });
  check("feed returns tokens", tokens.length > 0, `${tokens.length} tokens`);
  check(
    "every token has a mint",
    tokens.every((t) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.contract_address)),
  );
  check(
    "every premium matches the formula",
    tokens.every((t) => Math.abs(t.premiumPct - premiumPct(t)) < 1e-9),
  );

  const widest = [...tokens].sort((a, b) => a.premiumPct - b.premiumPct)[0];
  console.log(
    `        widest discount: ${widest.symbol} at ${widest.premiumPct.toFixed(2)}% ` +
      `($${widest.tokenPrice.toFixed(2)} vs $${widest.markPrice.toFixed(2)} NAV)`,
  );

  // -------------------------------------------------------------------------
  section("5. Jupiter routing and price sanity");

  for (const token of tokens) {
    try {
      const quote = await getQuote({
        inputMint: USDC_MINT,
        outputMint: token.contract_address,
        amount: 10_000_000n, // $10
        slippageBps: 100,
      });
      const usdValue = Number(quote.swapUsdValue ?? 0);
      check(
        `${token.symbol} routes and values correctly`,
        usdValue > 9.5 && usdValue < 10.5,
        `$10 in -> $${usdValue.toFixed(2)} out`,
      );
    } catch (error) {
      check(`${token.symbol} routes`, false, error instanceof Error ? error.message : "unknown");
    }
  }

  // -------------------------------------------------------------------------
  section("6. Trigger engine, end to end");

  const testId = 999_000_000_001n;
  await prisma.user.deleteMany({ where: { telegramId: testId } });
  await prisma.alertState.deleteMany({ where: { telegramId: testId } });
  await prisma.user.create({ data: { telegramId: testId } });

  // Arm a watch that today's data definitely crosses.
  const target = widest;
  const threshold = Math.floor(Math.abs(target.premiumPct)) - 2;
  await prisma.watch.create({
    data: { telegramId: testId, symbol: target.symbol, direction: "discount", thresholdPct: threshold },
  });

  const first = await runTick();
  const firstAlerts = first.outbox.filter((m) => m.chatId === testId);
  check(
    "an armed watch fires once on the crossing",
    firstAlerts.length === 1,
    `${firstAlerts.length} alert(s): ${firstAlerts[0]?.text.slice(0, 70) ?? "none"}`,
  );

  const second = await runTick();
  const secondAlerts = second.outbox.filter((m) => m.chatId === testId);
  check(
    "it does NOT fire again while still triggered",
    secondAlerts.length === 0,
    "this is what stops the bot spamming every 30 seconds",
  );

  const third = await runTick();
  check(
    "still silent on a third tick",
    third.outbox.filter((m) => m.chatId === testId).length === 0,
  );

  const state = await prisma.alertState.findFirst({ where: { telegramId: testId } });
  check("the latch is recorded", state?.currentlyTriggered === true);
  check("the fire time is recorded", state?.lastFiredAt != null);

  // A paused user's policies must not execute.
  await prisma.user.update({ where: { telegramId: testId }, data: { paused: true, signerActive: true } });
  await prisma.policy.create({
    data: {
      telegramId: testId,
      kind: "autobuy",
      symbol: target.symbol,
      thresholdPct: threshold,
      amountUsdc: 5,
    },
  });
  const paused = await runTick();
  check(
    "a paused user's auto-buy does not execute",
    paused.report.policiesExecuted === 0,
    "the kill switch is checked before the rule is claimed",
  );
  const pausedState = await prisma.alertState.findMany({
    where: { telegramId: testId, ruleKey: { startsWith: "policy:" } },
  });
  check(
    "and the policy stays armed for after the user resumes",
    pausedState.every((s) => !s.currentlyTriggered),
  );

  await prisma.user.deleteMany({ where: { telegramId: testId } });
  await prisma.alertState.deleteMany({ where: { telegramId: testId } });

  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nVerification crashed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
