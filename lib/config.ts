/**
 * Central environment access.
 *
 * Nothing here throws at import time. Parity's public dashboard has to boot and
 * render live PreStocks data on a machine that has no Telegram token, no Privy
 * app and no database — so every secret is read lazily and the feature that
 * needs it reports its own absence. `requireEnv` is the one place that turns a
 * missing variable into an error, and it names the variable so the fix is obvious.
 */

function env(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(key: string): string {
  const value = env(key);
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. See .env.example for what it should contain.`,
    );
  }
  return value;
}

/** True when the variable is set to something other than "false"/"0". */
function flag(key: string, fallback: boolean): boolean {
  const value = env(key);
  if (value === undefined) return fallback;
  return value !== "false" && value !== "0";
}

export const config = {
  /**
   * Public origin used to build the onboarding link the bot sends.
   *
   * Only ever read on the server. On Vercel this falls back to the deployment's
   * own production URL, so a fresh deploy sends working links before anyone has
   * remembered to set NEXT_PUBLIC_APP_URL — getting that wrong would send users
   * an onboarding link pointing at localhost.
   */
  appUrl:
    env("NEXT_PUBLIC_APP_URL") ??
    env("APP_URL") ??
    (env("VERCEL_PROJECT_PRODUCTION_URL")
      ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}`
      : undefined) ??
    (env("VERCEL_URL") ? `https://${env("VERCEL_URL")}` : undefined) ??
    "http://localhost:3000",

  telegram: {
    botToken: () => requireEnv("TELEGRAM_BOT_TOKEN"),
    botTokenOptional: () => env("TELEGRAM_BOT_TOKEN"),
    /** Telegram echoes this back in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
    webhookSecret: () => env("TELEGRAM_WEBHOOK_SECRET"),
    botUsername: () => env("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME") ?? env("TELEGRAM_BOT_USERNAME"),
  },

  privy: {
    appId: () => requireEnv("PRIVY_APP_ID"),
    appIdOptional: () => env("PRIVY_APP_ID") ?? env("NEXT_PUBLIC_PRIVY_APP_ID"),
    appSecret: () => requireEnv("PRIVY_APP_SECRET"),
    /**
     * Base64-encoded PKCS8 P-256 private key with the PEM header/footer stripped.
     * This is the server signer: possession of it is what lets Parity move a
     * user's funds, so it never leaves the server and is never logged.
     */
    authorizationKey: () => requireEnv("PRIVY_AUTHORIZATION_KEY"),
    authorizationKeyOptional: () => env("PRIVY_AUTHORIZATION_KEY"),
    /** Optional: a pre-created Privy policy id to attach to every new wallet. */
    policyId: () => env("PRIVY_POLICY_ID"),
  },

  solana: {
    /**
     * Helius (or any other real provider). The public mainnet RPC rate-limits
     * hard enough that the poller would miss ticks, so we refuse to fall back to it.
     */
    rpcUrl: () => {
      const explicit = env("SOLANA_RPC_URL") ?? env("HELIUS_RPC_URL");
      if (explicit) return explicit;
      const heliusKey = env("HELIUS_API_KEY");
      if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
      throw new Error(
        "Missing Solana RPC. Set HELIUS_API_KEY (free tier is fine) or SOLANA_RPC_URL. " +
          "Parity deliberately does not fall back to the public mainnet RPC, which rate-limits.",
      );
    },
    rpcUrlOptional: () => {
      try {
        return config.solana.rpcUrl();
      } catch {
        return undefined;
      }
    },
  },

  /** Shared secret required by /api/cron/poll so the tick cannot be triggered by anyone. */
  cronSecret: () => env("CRON_SECRET"),

  /**
   * Dry run is the default and has to be switched off deliberately.
   *
   * In dry-run every path runs for real — quote, transaction build, policy
   * checks, database writes — except the final handoff to Privy's signer. That
   * makes it safe to demo the trigger engine on live data without spending
   * anything, and it means the only difference between the demo and production
   * is one environment variable.
   */
  dryRun: () => flag("DRY_RUN", true),
} as const;

/** Which integrations are actually configured — drives the setup banner in the UI. */
export function readiness() {
  return {
    database: Boolean(env("DATABASE_URL")),
    telegram: Boolean(env("TELEGRAM_BOT_TOKEN")),
    privy: Boolean(env("PRIVY_APP_ID") && env("PRIVY_APP_SECRET") && env("PRIVY_AUTHORIZATION_KEY")),
    rpc: Boolean(config.solana.rpcUrlOptional()),
    dryRun: config.dryRun(),
  };
}
