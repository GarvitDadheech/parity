/**
 * Live token feed for the dashboard.
 *
 * The public table polls this rather than re-rendering on the server, so the
 * numbers tick without a navigation. It carries the tradability flag alongside
 * the prices so the UI can mark an unroutable mint instead of hiding it, and it
 * reports how the prices were sourced so the UI can admit when they are stale.
 */

import { isTradable } from "@/lib/jupiter/client";
import { loadFeed } from "@/lib/prestocks/feed";

export const dynamic = "force-dynamic";

/**
 * Routability barely changes, and probing every mint per request would both be
 * slow and be rude to Jupiter. A failed probe leaves the previous answer alone.
 */
let tradableCache: { at: number; map: Record<string, boolean> } | null = null;
const TRADABLE_TTL_MS = 10 * 60_000;
let tradableInFlight: Promise<Record<string, boolean>> | null = null;

async function tradabilityMap(
  mints: Array<{ symbol: string; mint: string }>,
): Promise<Record<string, boolean> | undefined> {
  if (tradableCache && Date.now() - tradableCache.at < TRADABLE_TTL_MS) {
    return tradableCache.map;
  }

  if (!tradableInFlight) {
    tradableInFlight = (async () => {
      const entries = await Promise.all(
        mints
          .filter((m) => m.mint)
          .map(async ({ symbol, mint }) => [symbol, await isTradable(mint)] as const),
      );
      const map = Object.fromEntries(entries);
      tradableCache = { at: Date.now(), map };
      return map;
    })().finally(() => {
      tradableInFlight = null;
    });
  }

  try {
    return await tradableInFlight;
  } catch {
    // Never let a tradability probe fail the price feed — prices matter more.
    return tradableCache?.map;
  }
}

export async function GET(): Promise<Response> {
  try {
    // Prices first, so a slow Jupiter probe can never delay them.
    const base = await loadFeed();
    const tradable = await tradabilityMap(
      base.tokens.map((t) => ({ symbol: t.symbol, mint: t.mint })),
    );

    return Response.json({
      ...base,
      tokens: base.tokens.map((token) => ({
        ...token,
        tradable: tradable?.[token.symbol] ?? token.tradable,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load PreStocks" },
      { status: 502 },
    );
  }
}
