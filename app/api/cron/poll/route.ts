/**
 * Trigger engine tick.
 *
 * Called on a schedule (Vercel Cron, or any always-on worker for sub-minute
 * intervals). The endpoint is idempotent and holds a lease-based lock, so
 * calling it twice concurrently is safe — the second call returns immediately
 * rather than running a second tick.
 */

import { deliverOutbox, botConfigured } from "@/bot/bot";
import { config } from "@/lib/config";
import { runTick } from "@/lib/triggers/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = config.cronSecret();
  // No secret configured is only acceptable outside production.
  if (!secret) return process.env.NODE_ENV !== "production";

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;

  // Vercel Cron sends the secret as a bearer token; allow a query parameter too
  // so the tick can be driven from a plain worker or curl during a demo.
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const { report, outbox } = await runTick();

  // Messages are delivered after the tick has committed, so a Telegram outage
  // can never roll back a trade that actually executed.
  const delivery = botConfigured()
    ? await deliverOutbox(outbox)
    : { sent: 0, failed: outbox.length };

  return Response.json({
    ...report,
    durationMs: Date.now() - started,
    messagesQueued: outbox.length,
    messagesSent: delivery.sent,
    messagesFailed: delivery.failed,
    dryRun: config.dryRun(),
  });
}

export const GET = handle;
export const POST = handle;
