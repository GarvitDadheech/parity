/**
 * Standalone poller for sub-minute ticks.
 *
 * Vercel Cron's finest granularity is one minute, which is fine for alerts but
 * leaves a wide window on a fast-moving discount. Run this on Railway, Render or
 * any always-on box to tick faster; it calls exactly the same service layer as
 * the cron route, so behaviour and guardrails are identical.
 *
 *   npm run poll -- 30        # tick every 30 seconds
 */

import { deliverOutbox, botConfigured } from "../bot/bot";
import { runTick } from "../lib/triggers/engine";

const intervalSeconds = Number(process.argv[2] ?? 30);

async function tick() {
  const started = Date.now();
  try {
    const { report, outbox } = await runTick();
    const delivery = botConfigured()
      ? await deliverOutbox(outbox)
      : { sent: 0, failed: outbox.length };

    console.log(
      `[${new Date().toISOString()}] priced=${report.tokensPriced} ` +
        `alerts=${report.alertsFired} executed=${report.policiesExecuted} ` +
        `rearmed=${report.rulesRearmed} sent=${delivery.sent} ` +
        `${Date.now() - started}ms` +
        (report.skipped.length ? ` skipped=${report.skipped.join(";")}` : "") +
        (report.errors.length ? ` errors=${report.errors.join(";")}` : ""),
    );
  } catch (error) {
    console.error(`[${new Date().toISOString()}] tick failed:`, error);
  }
}

console.log(`Parity poller starting — every ${intervalSeconds}s. Ctrl-C to stop.`);
void tick();
setInterval(() => void tick(), intervalSeconds * 1000);
