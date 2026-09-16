/**
 * Wallet balance reads.
 *
 * Balances are read straight from the chain rather than tracked in our database.
 * A user can fund, withdraw or trade outside Parity, and a locally-maintained
 * ledger would drift; the chain is the only account that is always right.
 */

import { PublicKey } from "@solana/web3.js";

import { getConnection, USDC_MINT } from "./connection";
import { getMintInfo, rawToUi } from "./mint";

export interface TokenBalance {
  mint: string;
  /** Amount as a human sees it, with the scaled-UI multiplier already applied. */
  uiAmount: number;
  raw: string;
}

/**
 * Every token balance the wallet holds, keyed by mint.
 *
 * `getParsedTokenAccountsByOwner` reports `uiAmount` already adjusted for the
 * scaled-UI extension, but it is only populated for accounts the RPC could
 * parse — so we recompute from the raw amount and our own mint info whenever the
 * mint is one we know about, and fall back to the RPC's figure otherwise.
 */
export async function getTokenBalances(owner: string): Promise<Map<string, TokenBalance>> {
  const connection = getConnection();
  const ownerKey = new PublicKey(owner);

  const [legacy, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(ownerKey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }),
    connection.getParsedTokenAccountsByOwner(ownerKey, {
      programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    }),
  ]);

  const balances = new Map<string, TokenBalance>();

  for (const { account } of [...legacy.value, ...token2022.value]) {
    const info = (account.data as { parsed: { info: Record<string, unknown> } }).parsed.info;
    const mint = String(info.mint);
    const amount = info.tokenAmount as { amount: string; uiAmount: number | null };

    const existing = balances.get(mint);
    const raw = BigInt(amount.amount) + BigInt(existing?.raw ?? "0");

    balances.set(mint, {
      mint,
      raw: raw.toString(),
      uiAmount: amount.uiAmount ?? 0,
    });
  }

  return balances;
}

/** USDC balance in dollars. */
export async function getUsdcBalance(owner: string): Promise<number> {
  const balances = await getTokenBalances(owner);
  const usdc = balances.get(USDC_MINT);
  return usdc ? Number(usdc.raw) / 1_000_000 : 0;
}

/** SOL balance — needed for transaction fees even when trading in USDC. */
export async function getSolBalance(owner: string): Promise<number> {
  const connection = getConnection();
  const lamports = await connection.getBalance(new PublicKey(owner));
  return lamports / 1_000_000_000;
}

/**
 * Balance of one PreStock, resolved through its mint's live multiplier so the
 * number matches what the dashboard and the bot both display.
 */
export async function getPreStockBalance(owner: string, mint: string): Promise<number> {
  const [balances, info] = await Promise.all([getTokenBalances(owner), getMintInfo(mint)]);
  const held = balances.get(mint);
  if (!held) return 0;
  return rawToUi(BigInt(held.raw), info);
}
