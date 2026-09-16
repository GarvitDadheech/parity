/**
 * Manual trading: preview, then confirm.
 *
 * The preview is a formatted chat message, not a wallet UI — the server already
 * holds a delegated signer, so Confirm is the only consent step. That makes the
 * preview the last place a user sees the numbers, which is why it shows the
 * execution price, the gap to NAV, the price impact and the route rather than
 * just an amount.
 *
 * The pending trade lives in the database, keyed by a random id carried in the
 * button. The callback data is therefore an opaque handle, not an instruction:
 * a user cannot edit the amount by crafting a callback, and re-pressing Confirm
 * finds the row already claimed and reports an expired preview instead of
 * trading twice.
 */

import { randomUUID } from "node:crypto";

import { InlineKeyboard, type Bot, type Context } from "grammy";

import { config } from "@/lib/config";
import { claimPendingTrade, createPendingTrade, getUser } from "@/lib/db/repositories";
import { findBySymbol } from "@/lib/prestocks/client";
import { executeSwap, GuardrailError, quoteSwap } from "@/lib/privy/execute";
import { NoRouteError } from "@/lib/jupiter/client";
import { solscanTx } from "@/lib/solana/connection";

import { esc, previewMessage } from "../messages/format";

/** A preview older than this is priced on stale data and must be re-taken. */
const PREVIEW_TTL_MS = 2 * 60_000;

function describeError(error: unknown): string {
  if (error instanceof GuardrailError) return error.message;
  if (error instanceof NoRouteError) {
    return "Jupiter has no route for this token right now, so it can't be traded.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function sendPreview(ctx: Context, side: "buy" | "sell", rawArgs: string): Promise<void> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const usage =
    side === "buy"
      ? "Usage: <code>/buy SPACEX 50</code> — spend $50 of USDC."
      : "Usage: <code>/sell SPACEX 0.25</code> or <code>/sell SPACEX all</code>.";

  if (args.length < 2) {
    await ctx.reply(usage, { parse_mode: "HTML" });
    return;
  }

  const [symbolArg, amountArg] = args;
  const user = await getUser(BigInt(ctx.from!.id));
  if (!user?.signerActive || !user.walletAddr) {
    await ctx.reply("You need a wallet first. Send /login to set one up.");
    return;
  }

  const token = await findBySymbol(symbolArg);
  if (!token) {
    await ctx.reply(`No PreStock called <b>${esc(symbolArg.toUpperCase())}</b>. Try /list.`, {
      parse_mode: "HTML",
    });
    return;
  }

  const sellAll = side === "sell" && amountArg.toLowerCase() === "all";
  const amount = sellAll ? 0 : Number(amountArg);
  if (!sellAll && (!Number.isFinite(amount) || amount <= 0)) {
    await ctx.reply(usage, { parse_mode: "HTML" });
    return;
  }

  try {
    const { summary, tokenAmountResolved, usdcAmountResolved } = await quoteSwap({
      user,
      symbol: token.symbol,
      mint: token.contract_address,
      usdcAmount: side === "buy" ? amount : undefined,
      tokenAmount: side === "sell" && !sellAll ? amount : undefined,
      sellAll,
      side,
    });

    const id = randomUUID();
    await createPendingTrade({
      id,
      telegramId: BigInt(ctx.from!.id),
      kind: side === "buy" ? "manual_buy" : "manual_sell",
      symbol: token.symbol,
      mint: token.contract_address,
      usdcAmount: usdcAmountResolved,
      tokenAmount: tokenAmountResolved,
      quotedPrice: summary.executionPrice,
      premiumPct: token.premiumPct,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    });

    const keyboard = new InlineKeyboard()
      .text("Confirm", `confirm:${id}`)
      .text("Cancel", `cancel:${id}`);

    await ctx.reply(
      previewMessage({ side, token, summary, dryRun: config.dryRun() }),
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  } catch (error) {
    await ctx.reply(describeError(error));
  }
}

export function registerTradingCommands(bot: Bot<Context>): void {
  bot.command("buy", async (ctx) => sendPreview(ctx, "buy", ctx.match ?? ""));
  bot.command("sell", async (ctx) => sendPreview(ctx, "sell", ctx.match ?? ""));

  // The Buy button on an alert just starts the normal preview flow, so an
  // alert-driven trade and a typed one go through identical checks.
  bot.callbackQuery(/^buyprompt:(.+)$/, async (ctx) => {
    const symbol = ctx.match![1];
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `How much USDC of <b>${esc(symbol)}</b>? Send <code>/buy ${esc(symbol)} 50</code> to preview $50.`,
      { parse_mode: "HTML" },
    );
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const id = ctx.match![1];
    await claimPendingTrade(id, BigInt(ctx.from.id));
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Cancelled. Nothing was executed.", { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    const id = ctx.match![1];
    const telegramId = BigInt(ctx.from.id);

    // Claiming deletes the row, so a double-tap can only succeed once.
    const pending = await claimPendingTrade(id, telegramId);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: "This preview has expired" });
      await ctx.editMessageText(
        "That preview is no longer valid — prices move. Run the command again for a fresh quote.",
      );
      return;
    }

    if (pending.expiresAt.getTime() < Date.now()) {
      await ctx.answerCallbackQuery({ text: "Expired" });
      await ctx.editMessageText("That preview expired. Run the command again for a fresh quote.");
      return;
    }

    await ctx.answerCallbackQuery({ text: "Executing…" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });

    const user = await getUser(telegramId);
    if (!user) {
      await ctx.reply("Account not found. Send /login.");
      return;
    }

    // Re-read the live gap: the number recorded against the trade must be the
    // one that was true when it executed, not when it was previewed.
    const token = await findBySymbol(pending.symbol);

    try {
      const result = await executeSwap({
        user,
        kind: pending.kind === "manual_sell" ? "manual_sell" : "manual_buy",
        symbol: pending.symbol,
        mint: pending.mint,
        usdcAmount: pending.kind === "manual_buy" ? pending.usdcAmount ?? undefined : undefined,
        tokenAmount: pending.kind === "manual_sell" ? pending.tokenAmount ?? undefined : undefined,
        premiumAtExec: token?.premiumPct ?? pending.premiumPct,
      });

      const link = result.signature
        ? `\n\n<a href="${solscanTx(result.signature)}">View on Solscan</a>`
        : "";

      await ctx.reply(`${result.ok ? "✅" : "⚠️"} ${esc(result.message)}${link}`, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      await ctx.reply(describeError(error));
    }
  });
}
