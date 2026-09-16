/**
 * The feed the UI reads.
 *
 * Layered deliberately, cheapest and freshest first:
 *   1. the shared in-process cache in ./client (one upstream call per 20s), then
 *   2. that same cache served stale if a refresh failed, then
 *   3. the LatestPrice rows the poller writes, which survive a process restart
 *      and an upstream outage alike.
 *
 * The result always says how it was sourced, so the dashboard can be honest
 * about showing data that isn't live rather than silently presenting old prices
 * as current ones.
 */

import { hasDatabase } from "@/lib/db/client";
import { prisma } from "@/lib/db/client";

import { fetchPreStocks, priceAgeMs } from "./client";
import { verdictFor } from "./math";
import type { PreStock, Verdict } from "./types";

export interface FeedToken {
  symbol: string;
  name: string;
  mint: string;
  image?: string;
  markPrice: number;
  tokenPrice: number;
  premiumPct: number;
  verdict: Verdict;
  markValuation: number;
  impliedValuation: number;
  supply: number;
  tradable: boolean;
}

export interface Feed {
  updatedAt: string;
  source: "live" | "cache" | "database";
  /** How old the prices are, in seconds. Zero when just fetched. */
  ageSeconds: number;
  tokens: FeedToken[];
}

function fromPreStock(token: PreStock, tradable: boolean): FeedToken {
  return {
    symbol: token.symbol,
    name: token.name,
    mint: token.contract_address,
    image: token.image,
    markPrice: token.markPrice,
    tokenPrice: token.tokenPrice,
    premiumPct: token.premiumPct,
    verdict: token.verdict,
    markValuation: token.markValuation,
    impliedValuation: token.impliedValuation,
    supply: token.supply,
    tradable,
  };
}

export async function loadFeed(
  tradability?: Record<string, boolean>,
): Promise<Feed> {
  try {
    const tokens = await fetchPreStocks();
    const ageMs = priceAgeMs() ?? 0;

    return {
      updatedAt: new Date(Date.now() - ageMs).toISOString(),
      source: ageMs < 1_000 ? "live" : "cache",
      ageSeconds: Math.round(ageMs / 1000),
      tokens: [...tokens]
        .sort((a, b) => a.premiumPct - b.premiumPct)
        .map((token) => fromPreStock(token, tradability?.[token.symbol] ?? true)),
    };
  } catch (error) {
    if (!hasDatabase()) throw error;

    // Upstream is unreachable and nothing is cached. The poller's rows are the
    // last thing standing between a judge and an error page.
    const rows = await prisma.latestPrice.findMany({ orderBy: { premiumPct: "asc" } });
    if (rows.length === 0) throw error;

    const newest = rows.reduce(
      (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
      rows[0].updatedAt,
    );

    console.warn("[feed] upstream unavailable, serving stored prices:", error);

    return {
      updatedAt: newest.toISOString(),
      source: "database",
      ageSeconds: Math.round((Date.now() - newest.getTime()) / 1000),
      tokens: rows.map((row) => ({
        symbol: row.symbol,
        name: row.name ?? row.symbol,
        mint: row.mint ?? "",
        markPrice: row.markPrice,
        tokenPrice: row.tokenPrice,
        premiumPct: row.premiumPct,
        verdict: verdictFor(row.premiumPct),
        markValuation: 0,
        impliedValuation: 0,
        supply: 0,
        tradable: row.tradable,
      })),
    };
  }
}
