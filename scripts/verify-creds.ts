/**
 * Proves each configured credential actually works, rather than merely being
 * present. Everything here is read-only — nothing is created, nothing is signed.
 */

import { getBot } from "../bot/bot";
import { config } from "../lib/config";
import { prisma } from "../lib/db/client";
import { getPrivy, privyConfigured } from "../lib/privy/server";
import { getConnection } from "../lib/solana/connection";

let pass = 0;
let fail = 0;
const ok = (name: string, detail = "") => { pass++; console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`); };
const no = (name: string, detail = "") => { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); };

async function main() {
  console.log("\nLive credential check\n=====================");

  // Database
  try {
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() as now`;
    const users = await prisma.user.count();
    ok("Postgres reachable", `server time ${now.toISOString()}, ${users} user(s)`);
  } catch (e) {
    no("Postgres reachable", String(e).slice(0, 120));
  }

  // Helius RPC
  try {
    const conn = getConnection();
    const slot = await conn.getSlot();
    const version = await conn.getVersion();
    ok("Helius RPC", `slot ${slot}, solana-core ${version["solana-core"]}`);
  } catch (e) {
    no("Helius RPC", String(e).slice(0, 120));
  }

  // Privy app credentials
  if (!privyConfigured()) {
    no("Privy configured");
  } else {
    try {
      // Fetch the app itself: the smallest call that proves the app id and
      // secret are both accepted, and it works before any user has onboarded.
      const auth = Buffer.from(
        `${config.privy.appId()}:${config.privy.appSecret()}`,
      ).toString("base64");
      const response = await fetch(`https://api.privy.io/v1/apps/${config.privy.appId()}`, {
        headers: { authorization: `Basic ${auth}`, "privy-app-id": config.privy.appId() },
        signal: AbortSignal.timeout(20_000),
      });
      const app = (await response.json()) as { name?: string; error?: string };
      if (response.ok) {
        ok("Privy app id + secret accepted", `app "${app.name}"`);
      } else {
        no("Privy app id + secret", app.error ?? `HTTP ${response.status}`);
      }

      // How many people have actually completed onboarding.
      const users = await getPrivy().users().list({ limit: 20 });
      const list = users.data ?? [];
      const isEmbeddedSolana = (account: unknown): boolean => {
        const a = account as { chain_type?: string; connector_type?: string };
        return a.chain_type === "solana" && a.connector_type === "embedded";
      };
      const withSolana = list.filter((u) =>
        (u.linked_accounts ?? []).some(isEmbeddedSolana),
      );
      ok(
        "Privy users readable",
        list.length === 0
          ? "no one has onboarded yet"
          : `${list.length} user(s), ${withSolana.length} with a Solana wallet`,
      );
    } catch (e) {
      no("Privy app id + secret", String(e).slice(0, 160));
    }

    // Authorization key: check it parses as a P-256 PKCS8 key before we ever
    // rely on it to move money.
    try {
      const { createPrivateKey } = await import("node:crypto");
      const der = Buffer.from(config.privy.authorizationKey(), "base64");
      const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      const { namedCurve } = key.asymmetricKeyDetails ?? {};
      if (key.asymmetricKeyType === "ec" && namedCurve === "prime256v1") {
        ok("Authorization key is a valid P-256 key", "matches what Privy expects");
      } else {
        no("Authorization key curve", `got ${key.asymmetricKeyType}/${namedCurve}`);
      }
    } catch (e) {
      no("Authorization key parses", String(e).slice(0, 120));
    }

    if (config.privy.appId() && process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID) {
      ok("Signer quorum id present", process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID);
    } else {
      no("Signer quorum id");
    }
  }

  // Telegram
  try {
    const bot = getBot();
    const me = await bot.api.getMe();
    const hook = await bot.api.getWebhookInfo();
    ok("Telegram bot token", `@${me.username}`);
    if (hook.url) {
      ok("Webhook registered", hook.url);
      if (hook.last_error_message) {
        no("Webhook delivering cleanly", `Telegram's last error: ${hook.last_error_message}`);
      } else {
        ok("No webhook delivery errors", `${hook.pending_update_count} pending`);
      }
    } else {
      no("Webhook registered", "run: npm run bot:setup -- <public-url>");
    }
  } catch (e) {
    no("Telegram", String(e).slice(0, 140));
  }

  // Safety posture
  console.log(`\n  ${config.dryRun() ? "DRY RUN is ON — no real swap can execute" : "LIVE MODE — real swaps will execute"}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
