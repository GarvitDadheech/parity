/** Read-only market commands. These work for anyone, wallet or not. */

import type { Bot, Context } from "grammy";

import { config } from "@/lib/config";
import { displayName, fetchPreStocksRanked, findBySymbol } from "@/lib/prestocks/client";
import { VERDICT_LABEL } from "@/lib/prestocks/math";
import { compactUsd, DISCLAIMER, signedPct, usd } from "@/lib/format";
import { solscanToken } from "@/lib/solana/connection";

import { esc, gapDot, helpMessage, listMessage, welcomeMessage } from "../messages/format";

export function registerMarketCommands(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(welcomeMessage(config.appUrl), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpMessage(), { parse_mode: "HTML" });
  });

  bot.command("list", async (ctx) => {
    const tokens = await fetchPreStocksRanked();
    await ctx.reply(listMessage(tokens), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command("price", async (ctx) => {
    const symbol = ctx.match?.trim().split(/\s+/)[0];
    if (!symbol) {
      await ctx.reply("Usage: <code>/price SPACEX</code>", { parse_mode: "HTML" });
      return;
    }

    const token = await findBySymbol(symbol);
    if (!token) {
      await ctx.reply(`No PreStock called <b>${esc(symbol.toUpperCase())}</b>. Try /list.`, {
        parse_mode: "HTML",
      });
      return;
    }

    const below = token.premiumPct < 0;
    await ctx.reply(
      `${gapDot(token.premiumPct)} <b>${esc(token.symbol)}</b> · ${esc(displayName(token))}\n\n` +
        `<b>${usd(token.tokenPrice)}</b> market\n` +
        `<b>${usd(token.markPrice)}</b> NAV (backed fair value)\n` +
        `<b>${signedPct(token.premiumPct, 2)}</b> — ${VERDICT_LABEL[token.verdict]}\n\n` +
        `Trading ${Math.abs(token.premiumPct).toFixed(1)}% ${below ? "below" : "above"} what it's backed by.\n` +
        `Implied valuation ${compactUsd(token.impliedValuation)} vs ${compactUsd(token.markValuation)} at NAV.\n\n` +
        `<a href="${solscanToken(token.contract_address)}">Mint on Solscan</a> · ` +
        `<a href="${config.appUrl}/t/${encodeURIComponent(token.symbol)}">Chart</a>\n\n` +
        `<i>${DISCLAIMER}</i>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });
}
