/**
 * Mint introspection for PreStocks tokens.
 *
 * PreStocks are not plain SPL tokens. They are Token-2022 mints carrying several
 * extensions that materially change the arithmetic and the risk, and getting any
 * of them wrong is a silent money bug rather than a crash:
 *
 *  - `scaledUiAmountConfig` — the mint publishes a multiplier that sits between
 *    raw on-chain units and the amount a human sees. SPACEX currently runs a
 *    multiplier of 5, so the naive `raw / 10^decimals` that works for every
 *    normal token would report a position five times too small. The multiplier
 *    also has a scheduled successor, so "which multiplier is live" is a function
 *    of the current time, not a constant.
 *  - `transferFeeConfig` — a transfer fee (0.5% at time of writing) is withheld
 *    on every movement of the token, so a sale does not return the full notional.
 *  - `pausableConfig` — the issuer can pause transfers, which makes swaps fail.
 *  - `permanentDelegate` — the issuer retains the ability to move tokens from any
 *    account. Parity surfaces this rather than hiding it; it is the single
 *    largest piece of counterparty risk in holding these tokens.
 *
 * Everything is read from the chain and cached, never hardcoded, because the
 * multiplier and the fee are both designed to change.
 */

import { PublicKey } from "@solana/web3.js";

import { getConnection } from "./connection";

export interface MintInfo {
  mint: string;
  decimals: number;
  /** The Token-2022 program, for these mints. */
  programId: string;
  /** Live scaled-UI multiplier: uiAmount = rawAmount / 10^decimals * multiplier. */
  uiMultiplier: number;
  /** Transfer fee withheld on every transfer, in basis points. */
  transferFeeBps: number;
  /** Transfers are currently halted by the issuer — swaps will fail. */
  paused: boolean;
  /** The issuer can move these tokens out of any account without the owner's consent. */
  hasPermanentDelegate: boolean;
}

const cache = new Map<string, { at: number; info: MintInfo }>();
/**
 * Five minutes. The multiplier changes on a published schedule rather than
 * per-block, but a stale one would misprice every trade, so we do not hold it
 * for the lifetime of the process.
 */
const CACHE_MS = 5 * 60_000;

interface ParsedExtension {
  extension?: string;
  state?: Record<string, unknown>;
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Pick the multiplier that is actually in force right now.
 *
 * The extension holds the current multiplier alongside a scheduled replacement
 * and the timestamp it takes effect. Once that timestamp passes, the chain uses
 * the new one — so reading `multiplier` unconditionally is correct today and
 * wrong tomorrow.
 */
function resolveMultiplier(state: Record<string, unknown>): number {
  const current = num(state.multiplier, 1);
  const next = num(state.newMultiplier, current);
  const effectiveAt = num(state.newMultiplierEffectiveTimestamp, 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const multiplier = effectiveAt > 0 && nowSeconds >= effectiveAt ? next : current;
  // A zero or negative multiplier would make every amount nonsense; refuse it.
  return multiplier > 0 ? multiplier : 1;
}

export async function getMintInfo(mint: string): Promise<MintInfo> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.info;

  const connection = getConnection();
  const { value } = await connection.getParsedAccountInfo(new PublicKey(mint));

  if (!value || !("parsed" in value.data)) {
    throw new Error(`Could not read mint ${mint} from the chain`);
  }

  const parsed = value.data.parsed as { info?: Record<string, unknown> };
  const info = parsed.info ?? {};
  const extensions = (info.extensions as ParsedExtension[] | undefined) ?? [];

  const byName = (name: string) =>
    extensions.find((e) => e.extension === name)?.state ?? undefined;

  const scaled = byName("scaledUiAmountConfig");
  const transferFee = byName("transferFeeConfig") as
    | { newerTransferFee?: { transferFeeBasisPoints?: number } }
    | undefined;
  const pausable = byName("pausableConfig") as { paused?: boolean } | undefined;

  const result: MintInfo = {
    mint,
    decimals: num(info.decimals, 9),
    programId: value.owner.toBase58(),
    uiMultiplier: scaled ? resolveMultiplier(scaled) : 1,
    transferFeeBps: num(transferFee?.newerTransferFee?.transferFeeBasisPoints, 0),
    paused: pausable?.paused === true,
    hasPermanentDelegate: Boolean(byName("permanentDelegate")),
  };

  cache.set(mint, { at: Date.now(), info: result });
  return result;
}

/** Human-facing amount -> the raw integer the chain and Jupiter both expect. */
export function uiToRaw(uiAmount: number, info: Pick<MintInfo, "decimals" | "uiMultiplier">): bigint {
  const base = uiAmount / info.uiMultiplier;
  // Round rather than truncate: truncating repeatedly biases every amount down.
  return BigInt(Math.round(base * 10 ** info.decimals));
}

/** Raw chain integer -> the amount a human should be shown. */
export function rawToUi(raw: bigint | string | number, info: Pick<MintInfo, "decimals" | "uiMultiplier">): number {
  const value = typeof raw === "bigint" ? Number(raw) : Number(raw);
  return (value / 10 ** info.decimals) * info.uiMultiplier;
}

/** USDC is a plain 6-decimal SPL token, so it needs no multiplier handling. */
export function usdcToRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export function rawToUsdc(raw: bigint | string | number): number {
  return Number(raw) / 1_000_000;
}
