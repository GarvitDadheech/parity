/**
 * The poller.
 *
 * Vercel's Hobby plan caps cron jobs at once per day, which is useless for a
 * trigger engine that needs to see a crossing within seconds. So the poller runs
 * as its own process — locally, or on any always-on host — in one of two modes:
 *
 *   in-process  (default)  runs runTick() directly. Needs DATABASE_URL and the
 *                          rest of the environment. Use this on a worker host.
 *   remote      (POLL_URL) calls a deployment's /api/cron/poll over HTTP. Needs
 *                          only the URL and CRON_SECRET, so you can drive a
 *                          production deployment from anywhere, including a
 *                          laptop, without holding any other credential.
 *
 *   npm run poll -- 30                        # in-process, every 30s
 *   POLL_URL=https://… npm run poll -- 30     # drive a deployment
 */

const intervalSeconds = Math.max(5, Number(process.argv[2] ?? 30));
const remoteUrl = process.env.POLL_URL;
const cronSecret = process.env.CRON_SECRET;

interface TickSummary {
  tokensPriced?: number;
  alertsFired?: number;
  policiesExecuted?: number;
  rulesRearmed?: number;
  messagesSent?: number;
  skipped?: string[];
  errors?: string[];
}

function line(started: number, s: TickSummary, extra = ""): string {
  return (
    `[${new Date().toISOString()}] ` +
    `priced=${s.tokensPriced ?? 0} alerts=${s.alertsFired ?? 0} ` +
    `executed=${s.policiesExecuted ?? 0} rearmed=${s.rulesRearmed ?? 0} ` +
    `sent=${s.messagesSent ?? 0} ${Date.now() - started}ms${extra}` +
    (s.skipped?.length ? ` skipped=${s.skipped.join(";")}` : "") +
    (s.errors?.length ? ` errors=${s.errors.join(";")}` : "")
  );
}

async function tickRemote(): Promise<void> {
  const started = Date.now();
  try {
    const response = await fetch(`${remoteUrl!.replace(/\/$/, "")}/api/cron/poll`, {
      headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json()) as TickSummary & { error?: string };
    if (!response.ok) {
      console.error(`[${new Date().toISOString()}] HTTP ${response.status}: ${body.error ?? "failed"}`);
      return;
    }
    console.log(line(started, body, " remote"));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] request failed:`, error);
  }
}

async function tickLocal(): Promise<void> {
  const started = Date.now();
  const { deliverOutbox, botConfigured } = await import("../bot/bot");
  const { runTick } = await import("../lib/triggers/engine");

  try {
    const { report, outbox } = await runTick();
    const delivery = botConfigured()
      ? await deliverOutbox(outbox)
      : { sent: 0, failed: outbox.length };
    console.log(line(started, { ...report, messagesSent: delivery.sent }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] tick failed:`, error);
  }
}

const tick = remoteUrl ? tickRemote : tickLocal;

if (remoteUrl && !cronSecret) {
  console.error("POLL_URL is set but CRON_SECRET is not — the endpoint will reject every call.");
  process.exit(1);
}

console.log(
  `Parity poller — every ${intervalSeconds}s, ` +
    (remoteUrl ? `driving ${remoteUrl}` : "in-process") +
    ". Ctrl-C to stop.",
);
void tick();
setInterval(() => void tick(), intervalSeconds * 1000);
