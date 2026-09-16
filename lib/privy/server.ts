/**
 * Privy server client and wallet provisioning.
 *
 * Parity's server holds a delegated signer on each user's embedded wallet. That
 * is what lets an automated policy execute without a wallet popup, and it is
 * also the most dangerous capability in the system — so the authorization key is
 * read from the environment on every call rather than being stashed anywhere,
 * and every code path that reaches the signer goes through executeSwap in
 * ./execute.ts, which enforces the user's caps first.
 */

import { PrivyClient } from "@privy-io/node";

import { config } from "@/lib/config";

let client: PrivyClient | null = null;

export function getPrivy(): PrivyClient {
  if (!client) {
    client = new PrivyClient({
      appId: config.privy.appId(),
      appSecret: config.privy.appSecret(),
    });
  }
  return client;
}

/**
 * The authorization context attached to every signing request.
 *
 * Privy signs the request body with this P-256 key and verifies it against the
 * public key registered in the dashboard. Without it the wallet API refuses to
 * act, which is exactly the property we want: losing the app secret alone is not
 * enough to move a user's funds.
 */
export function authorizationContext() {
  return {
    authorization_private_keys: [config.privy.authorizationKey()],
  };
}

export function privyConfigured(): boolean {
  try {
    config.privy.appId();
    config.privy.appSecret();
    config.privy.authorizationKey();
    return true;
  } catch {
    return false;
  }
}

/** Look up a Privy user by their Telegram id, per Privy's Telegram-bot recipe. */
export async function getUserByTelegramId(telegramUserId: string) {
  const privy = getPrivy();
  try {
    return await privy.users().getByTelegramUserID({ telegram_user_id: telegramUserId });
  } catch {
    return null;
  }
}

interface SolanaWalletAccount {
  chain_type?: string;
  connector_type?: string;
  address?: string;
  id?: string | null;
  /** True once a session signer has been granted on this wallet. */
  delegated?: boolean;
}

/**
 * Pull the embedded Solana wallet out of a Privy user's linked accounts.
 *
 * A user can have several wallets linked; we want the embedded Solana one,
 * because that is the only one our signer can act on.
 */
export function findSolanaWallet(
  user: { linked_accounts?: unknown[] } | null,
): { walletId: string; address: string; delegated: boolean } | null {
  if (!user?.linked_accounts) return null;

  for (const account of user.linked_accounts as SolanaWalletAccount[]) {
    const isSolana = account.chain_type === "solana";
    const isEmbedded = account.connector_type === "embedded";
    if (isSolana && isEmbedded && account.address && account.id) {
      return { walletId: account.id, address: account.address, delegated: account.delegated === true };
    }
  }
  return null;
}

/**
 * Create a Privy policy that constrains what the server signer may do.
 *
 * Two of the four guardrails live here, on Privy's side, where they hold even if
 * Parity's own code is wrong:
 *   - the signer may only invoke allowlisted programs (Jupiter and the token
 *     programs), so a stolen key cannot drain the wallet with a plain transfer;
 *   - token transfers are capped per transaction.
 *
 * The daily cap is not expressible as a Privy rule — Privy evaluates one request
 * at a time and has no notion of a rolling window — so Parity enforces that one
 * itself in executeSwap, against the Trade table. Both are checked; neither is
 * assumed.
 */
export async function createSignerPolicy(params: {
  name: string;
  allowedPrograms: string[];
  maxTransferRaw: string;
}): Promise<string> {
  const privy = getPrivy();
  const policy = await privy.policies().create({
    version: "1.0",
    name: params.name,
    chain_type: "solana",
    rules: [
      {
        name: "Only allowlisted programs",
        method: "signAndSendTransaction",
        action: "ALLOW",
        conditions: [
          {
            field_source: "solana_program_instruction",
            field: "programId",
            operator: "in",
            value: params.allowedPrograms,
          },
        ],
      },
      {
        name: "Per-transaction transfer cap",
        method: "signAndSendTransaction",
        action: "ALLOW",
        conditions: [
          {
            field_source: "solana_token_program_instruction",
            field: "TransferChecked.amount",
            operator: "lte",
            value: params.maxTransferRaw,
          },
        ],
      },
    ],
  });

  return policy.id;
}
