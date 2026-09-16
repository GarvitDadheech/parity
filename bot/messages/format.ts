/**
 * Message formatters for the Telegram bot.
 *
 * Everything the bot says is built here so the voice stays consistent and the
 * disclaimer cannot be forgotten on a path that talks about money. Messages are
 * sent with HTML parse mode, so any value that could contain user input or an
 * API string goes through `esc`.
 */

import { displayName } from "@/lib/prestocks/client";
import { VERDICT_LABEL } from "@/lib/prestocks/math";
import type { PreStock } from "@/lib/prestocks/types";
import { DISCLAIMER, signedPct, tokenAmount, usd } from "@/lib/format";
import type { QuoteSummary } from "@/lib/privy/execute";

export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Green marks a discount, red a premium — the same convention as the dashboard. */
export function gapDot(premium: number): string {
  if (premium <= -3) return "\u{1F7E2}";
  if (premium >= 3) return "\u{1F534}";
  return "⚪";
}

export function tokenLine(token: PreStock): string {
  return (
    `${gapDot(token.premiumPct)} <b>${esc(token.symbol)}</b>  ` +
    `${usd(token.tokenPrice)} vs ${usd(token.markPrice)} NAV  ` +
    `<b>${signedPct(token.premiumPct, 1)}</b> (${VERDICT_LABEL[token.verdict]})`
  );
}

export function listMessage(tokens: PreStock[]): string {
  const lines = tokens.map(tokenLine).join("\n");
  return (
    `<b>PreStocks — price vs fair value</b>\n\n${lines}\n\n` +
    `<i>Market price vs NAV, the backed fair value from each token's 1:1 SPV.</i>\n` +
    `<i>${DISCLAIMER}</i>`
  );
}

export function welcomeMessage(dashboardUrl: string): string {
  return (
    `<b>Parity</b>\n\n` +
    `Every PreStock has two prices: what it's backed by (NAV) and what it trades for. ` +
    `Parity shows you the gap and lets you act on it — manually, or automatically when it crosses your threshold.\n\n` +
    `<b>Start here</b>\n` +
    `/list — every token ranked by its gap to fair value\n` +
    `/login — connect a wallet so you can trade\n` +
    `/help — everything else\n\n` +
    `Dashboard: ${esc(dashboardUrl)}\n\n` +
    `<i>${DISCLAIMER}</i>`
  );
}

export function helpMessage(): string {
  return (
    `<b>Parity commands</b>\n\n` +
    `<b>Market</b>\n` +
    `/list — all tokens ranked by gap to fair value\n` +
    `/price &lt;SYMBOL&gt; — one token in detail\n\n` +
    `<b>Account</b>\n` +
    `/login — connect wallet and set your limits\n` +
    `/balance — USDC, SOL and wallet address\n` +
    `/portfolio — holdings with live NAV gap and P&amp;L\n\n` +
    `<b>Alerts</b>\n` +
    `/watch &lt;SYMBOL&gt; &lt;discount|premium&gt; &lt;pct&gt; — e.g. <code>/watch SPACEX discount 15</code>\n` +
    `/unwatch &lt;SYMBOL&gt;\n` +
    `/alerts — your active watches\n\n` +
    `<b>Trading</b>\n` +
    `/buy &lt;SYMBOL&gt; &lt;usdc&gt; — preview, then confirm\n` +
    `/sell &lt;SYMBOL&gt; &lt;amount|all&gt; — preview, then confirm\n\n` +
    `<b>Automation</b>\n` +
    `/autobuy &lt;SYMBOL&gt; &lt;pct&gt; &lt;usdc&gt; — buy when it trades pct% below NAV\n` +
    `/autosell &lt;SYMBOL&gt; &lt;pct&gt; &lt;amount|all&gt; — sell when it trades pct% above NAV\n` +
    `/policies — active automation\n` +
    `/cancelpolicy &lt;id&gt;\n\n` +
    `<b>Safety</b>\n` +
    `/pause — stop all automated execution immediately\n` +
    `/resume — re-enable it\n\n` +
    `<i>${DISCLAIMER}</i>`
  );
}

export function previewMessage(params: {
  side: "buy" | "sell";
  token: PreStock;
  summary: QuoteSummary;
  dryRun: boolean;
}): string {
  const { side, token, summary } = params;
  const verb = side === "buy" ? "Buy" : "Sell";
  const gapPhrase =
    token.premiumPct < 0
      ? `${Math.abs(token.premiumPct).toFixed(1)}% below NAV`
      : `${token.premiumPct.toFixed(1)}% above NAV`;

  return (
    `<b>${verb} ${esc(token.symbol)}</b>\n\n` +
    `${summary.inputLabel} → ${summary.outputLabel}\n` +
    `Price ${usd(summary.executionPrice)} · NAV ${usd(token.markPrice)} · <b>${gapPhrase}</b>\n` +
    `Price impact ${summary.priceImpactPct.toFixed(2)}%${impactWarning(summary)} · max slippage ${(summary.slippageBps / 100).toFixed(2)}%\n` +
    `Route ${esc(summary.route.join(" + ") || "Jupiter")}\n\n` +
    (params.dryRun ? `⚠️ <b>DRY RUN</b> — confirming will not execute a real swap.\n\n` : "") +
    `<i>${DISCLAIMER}</i>`
  );
}

/**
 * Flag an expensive route in the preview itself.
 *
 * These markets are thin, so impact is the cost a user is most likely to
 * overlook — it needs to sit next to the number, not in a footnote.
 */
function impactWarning(summary: QuoteSummary): string {
  if (summary.priceImpactPct >= 2) return " \u26A0\uFE0F thin market";
  return "";
}

export function alertMessage(params: { token: PreStock; thresholdPct: number; direction: string }): string {
  const { token } = params;
  const below = token.premiumPct < 0;
  return (
    `${gapDot(token.premiumPct)} <b>${esc(token.symbol)}</b> is ` +
    `<b>${Math.abs(token.premiumPct).toFixed(1)}% ${below ? "BELOW" : "ABOVE"}</b> fair value\n\n` +
    `${usd(token.tokenPrice)} market · ${usd(token.markPrice)} NAV\n` +
    `${esc(displayName(token))} · ${VERDICT_LABEL[token.verdict]}\n\n` +
    `<i>${DISCLAIMER}</i>`
  );
}

export function portfolioMessage(params: {
  address: string;
  usdc: number;
  sol: number;
  positions: Array<{
    symbol: string;
    tokens: number;
    marketValue: number;
    navValue: number;
    premiumPct: number;
  }>;
}): string {
  if (params.positions.length === 0) {
    return (
      `<b>Portfolio</b>\n\n` +
      `${usd(params.usdc)} USDC · ${params.sol.toFixed(4)} SOL\n\n` +
      `No PreStock positions yet. <code>/list</code> to see what's trading below fair value.`
    );
  }

  const totalMarket = params.positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalNav = params.positions.reduce((sum, p) => sum + p.navValue, 0);

  const lines = params.positions
    .map(
      (p) =>
        `${gapDot(p.premiumPct)} <b>${esc(p.symbol)}</b>  ${tokenAmount(p.tokens)}\n` +
        `    ${usd(p.marketValue)} market · ${usd(p.navValue)} at NAV · <b>${signedPct(p.premiumPct, 1)}</b>`,
    )
    .join("\n");

  const gap = totalNav - totalMarket;
  return (
    `<b>Portfolio</b>\n\n` +
    `${lines}\n\n` +
    `<b>Total</b> ${usd(totalMarket)} market · ${usd(totalNav)} at NAV\n` +
    `<b>Gap to fair value</b> ${gap >= 0 ? "+" : "−"}${usd(Math.abs(gap))}\n` +
    `<b>Cash</b> ${usd(params.usdc)} USDC · ${params.sol.toFixed(4)} SOL\n\n` +
    `<i>Gap to fair value is what the position would be worth if the discount closed completely. ` +
    `${DISCLAIMER}</i>`
  );
}
