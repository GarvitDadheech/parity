/**
 * Telegram webhook.
 *
 * Telegram echoes TELEGRAM_WEBHOOK_SECRET back in a header on every call, and
 * the endpoint is public, so the check below is the only thing standing between
 * the bot and anyone who can guess the URL. It is not optional in production.
 */

import { webhookCallback } from "grammy";

import { getBot } from "@/bot/bot";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const expected = config.telegram.webhookSecret();
  if (expected) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== expected) {
      return new Response("Forbidden", { status: 403 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET is not set — refusing webhook traffic");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  try {
    const handler = webhookCallback(getBot(), "std/http");
    return await handler(request);
  } catch (error) {
    console.error("[telegram] webhook error", error);
    // Answer 200 regardless: a non-2xx makes Telegram retry the same update,
    // which for a trade confirmation would be exactly the wrong thing.
    return new Response("ok", { status: 200 });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    configured: Boolean(config.telegram.botTokenOptional()),
    hint: "Set this URL as the Telegram webhook with `npm run bot:setup`.",
  });
}
