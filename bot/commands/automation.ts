/** Alerts (/watch) and automated execution (/autobuy, /autosell). */

import type { Bot, Context } from "grammy";

import {
  addPolicy,
  addWatch,
  cancelPolicy,
  ensureUser,
  getUser,
  listPolicies,
  listWatches,
  removeWatches,
} from "@/lib/db/repositories";
import { findBySymbol } from "@/lib/prestocks/client";
import { HYSTERESIS_PCT } from "@/lib/prestocks/math";
import { DISCLAIMER, usd } from "@/lib/format";

import { esc } from "../messages/format";

function parseThreshold(value: string): number | null {
  const parsed = Number(value.replace(/%$/, ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return null;
  return parsed;
}

export function registerAutomationCommands(bot: Bot<Context>): void {
  bot.command("watch", async (ctx) => {
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    if (args.length < 3) {
      await ctx.reply(
        "Usage: <code>/watch SPACEX discount 15</code> — alert me when SPACEX trades 15% or more below NAV.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const [symbolArg, directionArg, thresholdArg] = args;
    const direction = directionArg.toLowerCase();
    if (direction !== "discount" && direction !== "premium") {
      await ctx.reply("Direction must be <code>discount</code> or <code>premium</code>.", {
        parse_mode: "HTML",
      });
      return;
    }

    const threshold = parseThreshold(thresholdArg);
    if (threshold === null) {
      await ctx.reply("Threshold must be a percentage between 0 and 100, e.g. <code>15</code>.", {
        parse_mode: "HTML",
      });
      return;
    }

    const token = await findBySymbol(symbolArg);
    if (!token) {
      await ctx.reply(`No PreStock called <b>${esc(symbolArg.toUpperCase())}</b>. Try /list.`, {
        parse_mode: "HTML",
      });
      return;
    }

    const telegramId = BigInt(ctx.from!.id);
    await ensureUser(telegramId);
    await addWatch({ telegramId, symbol: token.symbol, direction, thresholdPct: threshold });

    await ctx.reply(
      `Watching <b>${esc(token.symbol)}</b> for a <b>${threshold}%</b> ${direction}.\n\n` +
        `It's currently ${Math.abs(token.premiumPct).toFixed(1)}% ` +
        `${token.premiumPct < 0 ? "below" : "above"} NAV. ` +
        `You'll get one alert when it crosses, and it re-arms once the gap comes back inside ` +
        `${Math.max(0, threshold - HYSTERESIS_PCT).toFixed(0)}% — so it won't spam you at the boundary.`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("unwatch", async (ctx) => {
    const symbol = (ctx.match ?? "").trim().split(/\s+/)[0];
    if (!symbol) {
      await ctx.reply("Usage: <code>/unwatch SPACEX</code>", { parse_mode: "HTML" });
      return;
    }

    const count = await removeWatches(BigInt(ctx.from!.id), symbol.toUpperCase());
    await ctx.reply(
      count > 0
        ? `Removed ${count} watch${count === 1 ? "" : "es"} on <b>${esc(symbol.toUpperCase())}</b>.`
        : `No active watch on <b>${esc(symbol.toUpperCase())}</b>.`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("alerts", async (ctx) => {
    const watches = await listWatches(BigInt(ctx.from!.id));
    if (watches.length === 0) {
      await ctx.reply(
        "No active alerts. Try <code>/watch SPACEX discount 15</code>.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const lines = watches
      .map((w) => `· <b>${esc(w.symbol)}</b> — ${w.thresholdPct}% ${w.direction}`)
      .join("\n");
    await ctx.reply(`<b>Active alerts</b>\n\n${lines}\n\n<code>/unwatch SYMBOL</code> to remove one.`, {
      parse_mode: "HTML",
    });
  });

  bot.command("autobuy", async (ctx) => {
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    if (args.length < 3) {
      await ctx.reply(
        "Usage: <code>/autobuy SPACEX 15 50</code> — buy $50 automatically when SPACEX trades 15% below NAV.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const [symbolArg, thresholdArg, amountArg] = args;
    const threshold = parseThreshold(thresholdArg);
    const amount = Number(amountArg);

    if (threshold === null) {
      await ctx.reply("Threshold must be a percentage between 0 and 100.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply("Amount must be a positive number of USDC.");
      return;
    }

    const telegramId = BigInt(ctx.from!.id);
    const user = await getUser(telegramId);
    if (!user?.signerActive) {
      await ctx.reply("Automated trading needs a connected wallet. Send /login first.");
      return;
    }
    if (amount > user.maxTradeUsdc) {
      await ctx.reply(
        `That's above your per-trade cap of ${usd(user.maxTradeUsdc)}. ` +
          `Raise it on the dashboard, or pick a smaller amount.`,
      );
      return;
    }

    const token = await findBySymbol(symbolArg);
    if (!token) {
      await ctx.reply(`No PreStock called <b>${esc(symbolArg.toUpperCase())}</b>.`, { parse_mode: "HTML" });
      return;
    }

    const policy = await addPolicy({
      telegramId,
      kind: "autobuy",
      symbol: token.symbol,
      thresholdPct: threshold,
      amountUsdc: amount,
    });

    await ctx.reply(
      `<b>Auto-buy armed</b> · policy #${policy.id}\n\n` +
        `Buy ${usd(amount)} of <b>${esc(token.symbol)}</b> when it trades <b>${threshold}%</b> or more below NAV.\n` +
        `Currently ${Math.abs(token.premiumPct).toFixed(1)}% ${token.premiumPct < 0 ? "below" : "above"}.\n\n` +
        `This executes without asking, inside your caps: ${usd(user.maxTradeUsdc)} per trade, ` +
        `${usd(user.dailyCapUsdc)} per day. /pause stops everything instantly.\n\n` +
        `<i>${DISCLAIMER}</i>`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("autosell", async (ctx) => {
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    if (args.length < 3) {
      await ctx.reply(
        "Usage: <code>/autosell SPACEX 10 all</code> — sell the position when SPACEX trades 10% above NAV.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const [symbolArg, thresholdArg, amountArg] = args;
    const threshold = parseThreshold(thresholdArg);
    if (threshold === null) {
      await ctx.reply("Threshold must be a percentage between 0 and 100.");
      return;
    }

    const sellAll = amountArg.toLowerCase() === "all";
    const amount = sellAll ? null : Number(amountArg);
    if (!sellAll && (!Number.isFinite(amount!) || amount! <= 0)) {
      await ctx.reply("Amount must be a positive number of tokens, or <code>all</code>.", {
        parse_mode: "HTML",
      });
      return;
    }

    const telegramId = BigInt(ctx.from!.id);
    const user = await getUser(telegramId);
    if (!user?.signerActive) {
      await ctx.reply("Automated trading needs a connected wallet. Send /login first.");
      return;
    }

    const token = await findBySymbol(symbolArg);
    if (!token) {
      await ctx.reply(`No PreStock called <b>${esc(symbolArg.toUpperCase())}</b>.`, { parse_mode: "HTML" });
      return;
    }

    const policy = await addPolicy({
      telegramId,
      kind: "autosell",
      symbol: token.symbol,
      thresholdPct: threshold,
      amountToken: amount,
    });

    await ctx.reply(
      `<b>Auto-sell armed</b> · policy #${policy.id}\n\n` +
        `Sell ${sellAll ? "the whole position" : `${amount} ${esc(token.symbol)}`} ` +
        `when it trades <b>${threshold}%</b> or more above NAV.\n` +
        `Currently ${Math.abs(token.premiumPct).toFixed(1)}% ${token.premiumPct < 0 ? "below" : "above"}.\n\n` +
        `<i>${DISCLAIMER}</i>`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("policies", async (ctx) => {
    const telegramId = BigInt(ctx.from!.id);
    const [policies, user] = await Promise.all([listPolicies(telegramId), getUser(telegramId)]);

    if (policies.length === 0) {
      await ctx.reply(
        "No automation running. Try <code>/autobuy SPACEX 15 50</code>.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const lines = policies
      .map((p) => {
        const what =
          p.kind === "autobuy"
            ? `buy ${usd(p.amountUsdc ?? 0)}`
            : `sell ${p.amountToken == null ? "all" : p.amountToken}`;
        const side = p.kind === "autobuy" ? "below" : "above";
        return `· <b>#${p.id}</b> ${esc(p.symbol)} — ${what} at ${p.thresholdPct}% ${side} NAV`;
      })
      .join("\n");

    await ctx.reply(
      `<b>Active automation</b>${user?.paused ? " — <b>PAUSED</b>" : ""}\n\n${lines}\n\n` +
        `<code>/cancelpolicy ID</code> to remove one · /pause to halt everything`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("cancelpolicy", async (ctx) => {
    const idArg = (ctx.match ?? "").trim().replace(/^#/, "");
    const id = Number(idArg);
    if (!Number.isInteger(id)) {
      await ctx.reply("Usage: <code>/cancelpolicy 3</code>", { parse_mode: "HTML" });
      return;
    }

    const removed = await cancelPolicy(BigInt(ctx.from!.id), id);
    await ctx.reply(removed ? `Policy #${id} cancelled.` : `No active policy #${id}.`);
  });
}
