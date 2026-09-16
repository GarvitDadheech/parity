/**
 * Registers the Telegram webhook and publishes the command list.
 *
 * Run once per deployment (and again whenever the public URL changes):
 *   npm run bot:setup -- https://your-app.vercel.app
 *
 * Telegram will echo TELEGRAM_WEBHOOK_SECRET back on every call, which is what
 * the webhook route checks before doing anything.
 */

import { Bot } from "grammy";

const COMMANDS = [
  { command: "start", description: "What Parity does" },
  { command: "list", description: "All tokens ranked by gap to fair value" },
  { command: "price", description: "One token in detail" },
  { command: "login", description: "Connect a wallet" },
  { command: "balance", description: "USDC, SOL and your limits" },
  { command: "portfolio", description: "Holdings with live NAV gap" },
  { command: "watch", description: "Alert me at a threshold" },
  { command: "unwatch", description: "Remove an alert" },
  { command: "alerts", description: "Your active alerts" },
  { command: "buy", description: "Preview and confirm a buy" },
  { command: "sell", description: "Preview and confirm a sell" },
  { command: "autobuy", description: "Buy automatically at a discount" },
  { command: "autosell", description: "Sell automatically at a premium" },
  { command: "policies", description: "Active automation" },
  { command: "cancelpolicy", description: "Remove one policy" },
  { command: "pause", description: "Stop all automated execution" },
  { command: "resume", description: "Re-enable automated execution" },
  { command: "help", description: "Command reference" },
];

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not set. Put it in .env and try again.");
    process.exit(1);
  }

  const baseUrl = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    console.error("Usage: npm run bot:setup -- https://your-app.example.com");
    process.exit(1);
  }

  if (baseUrl.includes("localhost")) {
    console.error(
      "Telegram cannot reach localhost. Expose the app first (e.g. `ngrok http 3000`) and pass\n" +
        "the public URL, or deploy and use the deployed URL.",
    );
    process.exit(1);
  }

  const bot = new Bot(token);
  const me = await bot.api.getMe();
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    console.error(
      "TELEGRAM_WEBHOOK_SECRET is not set. Without it the webhook endpoint cannot tell\n" +
        "Telegram's requests from anyone else's. Set one and re-run.",
    );
    process.exit(1);
  }

  await bot.api.setWebhook(webhookUrl, {
    secret_token: secret,
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
  });

  await bot.api.setMyCommands(COMMANDS);

  const info = await bot.api.getWebhookInfo();

  console.log(`Bot:        @${me.username}`);
  console.log(`Webhook:    ${info.url}`);
  console.log(`Secret:     set`);
  console.log(`Commands:   ${COMMANDS.length} published`);
  if (info.last_error_message) {
    console.log(`Last error: ${info.last_error_message}`);
  }
  console.log(`\nAdd this to .env so the dashboard can link to the bot:`);
  console.log(`  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME="${me.username}"`);
}

main().catch((error) => {
  console.error("Setup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
