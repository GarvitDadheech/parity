/**
 * grammY bot assembly.
 *
 * The bot runs by webhook rather than long polling, so it lives inside the same
 * Next.js deployment as the dashboard and shares its services directly — no
 * second process, no second copy of the trading logic.
 */

import { Bot, InlineKeyboard, type Context } from "grammy";

import { config } from "@/lib/config";
import type { Outbox } from "@/lib/triggers/engine";

import { registerAccountCommands } from "./commands/account";
import { registerAutomationCommands } from "./commands/automation";
import { registerMarketCommands } from "./commands/market";
import { registerTradingCommands } from "./commands/trading";
import { esc } from "./messages/format";

let bot: Bot<Context> | null = null;

export function getBot(): Bot<Context> {
  if (bot) return bot;

  const instance = new Bot<Context>(config.telegram.botToken());

  registerMarketCommands(instance);
  registerAccountCommands(instance);
  registerAutomationCommands(instance);
  registerTradingCommands(instance);

  // A command that doesn't exist should point somewhere useful rather than
  // leaving the user guessing.
  instance.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) {
      await ctx.reply("I don't know that command. /help lists everything.");
      return;
    }
    await next();
  });

  instance.catch((error) => {
    console.error("[bot] unhandled error", error);
  });

  bot = instance;
  return bot;
}

export function botConfigured(): boolean {
  return Boolean(config.telegram.botTokenOptional());
}

/**
 * Deliver the messages a trigger tick produced.
 *
 * Failures are logged and skipped rather than thrown: a user who has blocked the
 * bot must not stop the rest of the outbox from being delivered, and the trade
 * that generated the message has already happened either way.
 */
export async function deliverOutbox(messages: Outbox[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const instance = getBot();
  let sent = 0;
  let failed = 0;

  for (const message of messages) {
    try {
      const keyboard =
        message.kind === "alert" && message.buyPrompt
          ? new InlineKeyboard().text(`Buy ${message.buyPrompt.symbol}`, `buyprompt:${message.buyPrompt.symbol}`)
          : undefined;

      await instance.api.sendMessage(String(message.chatId), esc(message.text), {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      sent += 1;
    } catch (error) {
      console.error("[bot] failed to deliver message", { chatId: String(message.chatId), error });
      failed += 1;
    }
  }

  return { sent, failed };
}
