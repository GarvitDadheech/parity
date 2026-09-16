/**
 * NAV-versus-price history for one symbol, from the snapshots the poller writes.
 *
 * An empty series is a real answer — it means the poller has not run yet — and
 * the chart says so rather than drawing a flat line.
 */

import { getPriceHistory } from "@/lib/db/repositories";
import { hasDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const hours = Math.min(Number(url.searchParams.get("hours") ?? 24) || 24, 24 * 30);

  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  if (!hasDatabase()) return Response.json({ symbol, points: [], reason: "no-database" });

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const points = await getPriceHistory(symbol.toUpperCase(), since);
    return Response.json({
      symbol: symbol.toUpperCase(),
      points: points.map((p) => ({
        ts: p.ts.toISOString(),
        markPrice: p.markPrice,
        tokenPrice: p.tokenPrice,
        premiumPct: p.premiumPct,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load history" },
      { status: 500 },
    );
  }
}
