/**
 * Client for the PreStocks token feed.
 *
 * The list of tokens is deliberately never hardcoded — PreStocks adds companies,
 * and a hardcoded list would quietly stop showing them.
 *
 * The upstream API rate-limits aggressively, and when it does it answers with a
 * plain-text "Too Many Requests" body rather than JSON. Parity has several
 * readers (every dashboard visitor, the poller, the bot), so hitting it once per
 * reader would reliably trip that limit and take the product down exactly when
 * people are looking at it. Three things prevent that:
 *
 *   1. One short-lived in-process cache serves every concurrent reader, and
 *      simultaneous misses share a single in-flight request rather than each
 *      starting their own.
 *   2. A failed refresh serves the last good data instead of throwing. Prices a
 *      minute old are worth far more than an error page, and the staleness is
 *      reported so the UI can say so.
 *   3. If there is no cache at all, the caller can fall back to the LatestPrice
 *      rows the poller writes — see `fetchPreStocksWithFallback`.
 */

import { enrich } from "./math";
import type { PreStock, PreStockRaw } from "./types";

const PRESTOCKS_URL = "https://prestocks.com/api/prestocks";

/** Long enough that a room full of viewers costs one upstream call. */
const CACHE_MS = 20_000;
/** How long stale data may still be served while upstream is failing. */
const STALE_LIMIT_MS = 10 * 60_000;

interface CacheEntry {
  at: number;
  data: PreStock[];
}

let cache: CacheEntry | null = null;
/** Deduplicates concurrent refreshes so ten readers make one request. */
let inFlight: Promise<PreStock[]> | null = null;

export class PreStocksUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreStocksUnavailableError";
  }
}

function isPreStockRaw(value: unknown): value is PreStockRaw {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.symbol === "string" &&
    typeof t.contract_address === "string" &&
    typeof t.markPrice === "number" &&
    Number.isFinite(t.markPrice) &&
    typeof t.tokenPrice === "number" &&
    Number.isFinite(t.tokenPrice)
  );
}

async function requestOnce(): Promise<PreStock[]> {
  const response = await fetch(PRESTOCKS_URL, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  // Read as text first. A rate-limited response is plain text, and calling
  // .json() on it throws a parse error that hides the actual cause.
  const body = await response.text();

  if (!response.ok) {
    throw new PreStocksUnavailableError(
      `PreStocks API returned ${response.status}: ${body.slice(0, 120)}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new PreStocksUnavailableError(
      `PreStocks API returned a non-JSON body: ${body.slice(0, 120)}`,
    );
  }

  if (!Array.isArray(payload)) {
    throw new PreStocksUnavailableError("PreStocks API did not return an array");
  }

  // Skip anything malformed rather than failing the whole feed: one bad row
  // should not take the dashboard down.
  const tokens = payload.filter(isPreStockRaw).map(enrich);
  if (tokens.length === 0) {
    throw new PreStocksUnavailableError("PreStocks API returned no usable tokens");
  }

  return tokens;
}

/** One retry, because the rate limiter clears quickly and a single blip is common. */
async function requestWithRetry(): Promise<PreStock[]> {
  try {
    return await requestOnce();
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      return await requestOnce();
    } catch {
      throw first;
    }
  }
}

export interface FetchOptions {
  /** Bypass the cache age check. Still deduplicated and still stale-tolerant. */
  force?: boolean;
}

export async function fetchPreStocks(options?: FetchOptions): Promise<PreStock[]> {
  const fresh = cache && Date.now() - cache.at < CACHE_MS;
  if (fresh && !options?.force) return cache!.data;

  if (!inFlight) {
    inFlight = requestWithRetry()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    return await inFlight;
  } catch (error) {
    // Serving prices a minute old beats serving an error. Only give up when the
    // cache is genuinely too old to be trusted for a trading decision.
    if (cache && Date.now() - cache.at < STALE_LIMIT_MS) {
      console.warn("[prestocks] serving cached prices after a failed refresh:", error);
      return cache.data;
    }
    throw error;
  }
}

/** How old the served data is, in milliseconds. Null when nothing is cached. */
export function priceAgeMs(): number | null {
  return cache ? Date.now() - cache.at : null;
}

/** Sorted cheapest-relative-to-fair-value first, which is the order that matters. */
export async function fetchPreStocksRanked(): Promise<PreStock[]> {
  const tokens = await fetchPreStocks();
  return [...tokens].sort((a, b) => a.premiumPct - b.premiumPct);
}

export async function findBySymbol(symbol: string): Promise<PreStock | undefined> {
  const wanted = symbol.trim().toUpperCase();
  const tokens = await fetchPreStocks();
  return tokens.find((t) => t.symbol.toUpperCase() === wanted);
}

/** Display name without the "PreStocks" suffix the API appends to every name. */
export function displayName(token: Pick<PreStock, "name" | "symbol">): string {
  return token.name.replace(/\s*PreStocks\s*$/i, "").trim() || token.symbol;
}
