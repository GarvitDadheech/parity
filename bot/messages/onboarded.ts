/**
 * The message the bot sends the moment onboarding completes.
 *
 * This is the hand-off back into the chat: the user left Telegram to use a
 * browser, and this is how they know it worked and what to do next. It shows the
 * wallet address plainly (they need to send funds to it), states the limits they
 * just agreed to, and asks for the one thing still missing — money — because a
 * connected wallet with no balance is the most likely place for someone to stall.
 */

import { usd } from "@/lib/format";
import { solscanAccount } from "@/lib/solana/connection";

import { esc } from "./format";

export function onboardedMessage(params: {
  walletAddress: string;
  maxTradeUsdc: number;
  dailyCapUsdc: number;
  slippageBps: number;
  maxPriceImpactBps: number;
  dryRun: boolean;
}): string {
  return (
    `✅ <b>Wallet connected.</b>\n\n` +
    `Your Solana wallet:\n<code>${esc(params.walletAddress)}</code>\n` +
    `<a href="${solscanAccount(params.walletAddress)}">View on Solscan</a>\n\n` +
    `<b>Now fund it</b>\n` +
    `Send <b>USDC</b> to trade with, and a little <b>SOL</b> for network fees ` +
    `(about 0.02 SOL is plenty). Tap the address above to copy it.\n\n` +
    `<b>Your limits</b>\n` +
    `${usd(params.maxTradeUsdc)} per trade · ${usd(params.dailyCapUsdc)} per day\n` +
    `${(params.slippageBps / 100).toFixed(2)}% max slippage · ` +
    `${(params.maxPriceImpactBps / 100).toFixed(2)}% max price impact\n` +
    `Parity can only ever act inside these. /pause stops everything instantly.\n\n` +
    (params.dryRun
      ? `⚠️ <b>Dry-run mode is on</b> — trades are simulated, not executed. ` +
        `You can rehearse the whole flow before funding anything.\n\n`
      : "") +
    `<b>What next</b>\n` +
    `/balance — check the funds have arrived\n` +
    `/list — see today's gaps to fair value\n` +
    `/autobuy SPACEX 15 50 — buy $50 automatically at a 15% discount`
  );
}

/** Sent once the wallet is funded, so the first deposit gets acknowledged. */
export function fundedMessage(params: { usdc: number; sol: number }): string {
  return (
    `✅ <b>Funds received.</b>\n\n` +
    `${usd(params.usdc)} USDC · ${params.sol.toFixed(4)} SOL\n\n` +
    `You're ready to trade. Try /list to see what's trading below fair value.`
  );
}
