/** Wallet onboarding, balances, portfolio, and the kill switch. */

import { randomUUID } from "node:crypto";

import type { Bot, Context } from "grammy";

import { config } from "@/lib/config";
import { ensureUser, getUser, setOnboardToken, setPaused } from "@/lib/db/repositories";
import { fetchPreStocks } from "@/lib/prestocks/client";
import { positionGap } from "@/lib/prestocks/math";
import { getSolBalance, getTokenBalances, getUsdcBalance } from "@/lib/solana/balances";
import { getMintInfo, rawToUi } from "@/lib/solana/mint";
import { solscanAccount } from "@/lib/solana/connection";
import { usd } from "@/lib/format";

import { esc, portfolioMessage } from "../messages/format";

export function registerAccountCommands(bot: Bot<Context>): void {
  bot.command("login", async (ctx) => {
    const telegramId = BigInt(ctx.from!.id);
    await ensureUser(telegramId);

    // A fresh token each time, so an old link someone shared cannot be reused
    // to attach a wallet to this chat.
    const token = randomUUID();
    await setOnboardToken(telegramId, token);

    const url = `${config.appUrl}/onboard?t=${token}`;
    const user = await getUser(telegramId);

    await ctx.reply(
      user?.signerActive
        ? `Your wallet is already connected.\n\n` +
            `<code>${esc(user.walletAddr ?? "")}</code>\n\n` +
            `To change your limits or reconnect, open:\n${esc(url)}`
        : `<b>Connect your wallet</b>\n\n` +
            `Open this link to log in, create a Solana wallet, fund it, and set your trading limits. ` +
            `It takes about a minute, and you only do it once.\n\n` +
            `${esc(url)}\n\n` +
            `<i>The link is personal to this chat — don't share it.</i>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("balance", async (ctx) => {
    const user = await getUser(BigInt(ctx.from!.id));
    if (!user?.walletAddr) {
      await ctx.reply("No wallet yet. Send /login to set one up.");
      return;
    }

    const [usdc, sol] = await Promise.all([
      getUsdcBalance(user.walletAddr),
      getSolBalance(user.walletAddr),
    ]);

    await ctx.reply(
      `<b>Wallet</b>\n<code>${esc(user.walletAddr)}</code>\n\n` +
        `<b>${usd(usdc)}</b> USDC\n<b>${sol.toFixed(4)}</b> SOL\n\n` +
        `<b>Limits</b>\n` +
        `${usd(user.maxTradeUsdc)} per trade · ${usd(user.dailyCapUsdc)} per day · ` +
        `${(user.slippageBps / 100).toFixed(2)}% max slippage\n` +
        `Automation ${user.paused ? "<b>PAUSED</b>" : "active"}\n\n` +
        `<a href="${solscanAccount(user.walletAddr)}">View on Solscan</a>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("portfolio", async (ctx) => {
    const user = await getUser(BigInt(ctx.from!.id));
    if (!user?.walletAddr) {
      await ctx.reply("No wallet yet. Send /login to set one up.");
      return;
    }

    const [tokens, balances, usdc, sol] = await Promise.all([
      fetchPreStocks(),
      getTokenBalances(user.walletAddr),
      getUsdcBalance(user.walletAddr),
      getSolBalance(user.walletAddr),
    ]);

    const positions = [];
    for (const token of tokens) {
      const held = balances.get(token.contract_address);
      if (!held || held.raw === "0") continue;

      // Re-derive from raw using our own multiplier rather than trusting the
      // RPC's uiAmount, so the bot and the dashboard always agree.
      const info = await getMintInfo(token.contract_address);
      const amount = rawToUi(BigInt(held.raw), info);
      if (amount <= 0) continue;

      const gap = positionGap({
        tokens: amount,
        markPrice: token.markPrice,
        tokenPrice: token.tokenPrice,
      });

      positions.push({
        symbol: token.symbol,
        tokens: amount,
        marketValue: gap.marketValue,
        navValue: gap.navValue,
        premiumPct: gap.premiumPct,
      });
    }

    positions.sort((a, b) => b.marketValue - a.marketValue);

    await ctx.reply(
      portfolioMessage({ address: user.walletAddr, usdc, sol, positions }),
      { parse_mode: "HTML" },
    );
  });

  bot.command("pause", async (ctx) => {
    const telegramId = BigInt(ctx.from!.id);
    await ensureUser(telegramId);
    await setPaused(telegramId, true);
    await ctx.reply(
      "<b>Paused.</b> No automated buy or sell will execute until you send /resume. " +
        "Your policies are kept, just not acted on.",
      { parse_mode: "HTML" },
    );
  });

  bot.command("resume", async (ctx) => {
    const telegramId = BigInt(ctx.from!.id);
    await ensureUser(telegramId);
    await setPaused(telegramId, false);
    await ctx.reply("<b>Resumed.</b> Automated execution is active again.", { parse_mode: "HTML" });
  });
}
