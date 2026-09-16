/**
 * Rehearses a buy end to end with no funds and no signer, proving that dry run
 * reports what would have happened — including which guardrails would have
 * stopped it — rather than refusing outright.
 */

import { prisma } from "../lib/db/client";
import { config } from "../lib/config";
import { executeSwap } from "../lib/privy/execute";
import { fetchPreStocks } from "../lib/prestocks/client";

async function main() {
  if (!config.dryRun()) {
    console.log("DRY_RUN is false — refusing to run this script against live execution.");
    process.exit(1);
  }

  const tokens = await fetchPreStocks({ force: true });
  const target = [...tokens].sort((a, b) => a.premiumPct - b.premiumPct)[0];

  const telegramId = 888000111n;
  await prisma.user.deleteMany({ where: { telegramId } });
  const user = await prisma.user.create({
    data: {
      telegramId,
      // Pretend onboarding finished, but point at an empty wallet.
      signerActive: true,
      walletId: "test-wallet-id",
      // A valid-but-unused address. Note: the System Program address is NOT
      // empty — people have burned thousands of USDC into it — so it is a
      // misleading choice of placeholder.
      walletAddr: "Hn5kXLmR9Gg1WVjKqPYb6vTJdQ2yNfEcAoZuS3tWx7Bv",
      maxTradeUsdc: 50,
      dailyCapUsdc: 200,
      slippageBps: 100,
      maxPriceImpactBps: 300,
    },
  });

  console.log(`\nRehearsing a $10 buy of ${target.symbol} at ${target.premiumPct.toFixed(2)}% to NAV`);
  console.log("=".repeat(66));

  const result = await executeSwap({
    user,
    kind: "manual_buy",
    symbol: target.symbol,
    mint: target.contract_address,
    usdcAmount: 10,
    premiumAtExec: target.premiumPct,
  });

  console.log(result.message);
  console.log("\n" + "-".repeat(66));
  console.log("quote:", JSON.stringify(result.quote, null, 1));
  console.log("trade row id:", result.tradeId, "| dryRun:", result.dryRun);

  const row = await prisma.trade.findUnique({ where: { id: result.tradeId! } });
  console.log("persisted status:", row?.status, "| dryRun flag:", row?.dryRun);

  const expectedBlock = (result.blockedBy ?? []).some((v) => v.includes("Not enough USDC"));
  console.log(
    `\n${expectedBlock ? "PASS" : "FAIL"}  empty wallet is reported as a blocker, not a crash`,
  );
  console.log(
    `${result.quote && result.quote.tokenAmount > 0 ? "PASS" : "FAIL"}  a real Jupiter quote was still obtained`,
  );

  await prisma.trade.deleteMany({ where: { telegramId } });
  await prisma.user.deleteMany({ where: { telegramId } });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
