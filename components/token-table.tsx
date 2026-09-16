"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { compactUsd, timeAgo } from "@/lib/format";
import { VERDICT_LABEL } from "@/lib/prestocks/math";
import type { Verdict } from "@/lib/prestocks/types";

import { ColumnLabel, GapValue, LivePrice } from "./numbers";

export interface TokenRow {
  symbol: string;
  name: string;
  mint: string;
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
  ageSeconds: number;
  tokens: TokenRow[];
}

const REFRESH_MS = 30_000;

function displayName(name: string): string {
  return name.replace(/\s*PreStocks\s*$/i, "").trim() || name;
}

function formatAge(seconds: number): string {
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

export function TokenTable({ initial }: { initial: Feed | null }) {
  const [feed, setFeed] = useState<Feed | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial === null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tokens", { cache: "no-store" });
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const data: Feed = await response.json();
      setFeed(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the price feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // When the server could not pre-render prices, fetch immediately — deferred
    // out of the effect body so the first paint is the skeleton rather than a
    // cascading re-render.
    const kickoff = initial === null ? window.setTimeout(() => void load(), 0) : undefined;
    const timer = window.setInterval(() => void load(), REFRESH_MS);

    return () => {
      if (kickoff !== undefined) window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [initial, load]);

  const stale = Boolean(feed && (feed.source === "database" || feed.ageSeconds > 90));

  if (loading) return <TableSkeleton />;

  if (error && !feed) {
    return (
      <div className="border-hairline rounded-sm border px-5 py-10 text-center">
        <p className="text-ink text-sm">The price feed is unreachable.</p>
        <p className="text-ink-dim mx-auto mt-2 max-w-prose text-xs">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="border-hairline-strong text-ink hover:border-accent hover:text-accent mt-5 inline-flex min-h-10 items-center rounded-sm border px-4 text-xs transition-colors duration-100"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!feed || feed.tokens.length === 0) {
    return (
      <div className="border-hairline rounded-sm border px-5 py-10 text-center">
        <p className="text-ink text-sm">No PreStocks are listed right now.</p>
        <p className="text-ink-dim mx-auto mt-2 max-w-prose text-xs">
          Parity reads the token list live, so new companies appear here as soon as PreStocks
          issues them.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              stale ? "bg-ink-faint" : "live-dot bg-discount"
            }`}
            aria-hidden="true"
          />
          <span className="text-ink-faint text-[10px] tracking-[0.08em] uppercase">
            {stale ? "Last known" : "Live"} · {feed.tokens.length} markets
          </span>
        </div>
        <span className="text-ink-faint tnum text-[10px]">
          {error ? "reconnecting\u2026" : `updated ${timeAgo(feed.updatedAt)}`}
        </span>
      </div>

      {/*
        When the upstream feed is rate-limiting, Parity keeps showing the last
        good prices rather than an error — but says so, because a stale price
        presented as live is worse than no price at all.
      */}
      {stale && (
        <p className="text-ink-faint border-hairline mb-3 border-b pb-3 text-[11px] leading-relaxed">
          The PreStocks feed is rate-limiting. These are the most recent prices Parity holds
          {feed.ageSeconds > 0 ? ` (${formatAge(feed.ageSeconds)} old)` : ""} — it will catch up on
          its own.
        </p>
      )}

      {/* Column headers, desktop only — on mobile each cell is labelled inline. */}
      <div className="border-hairline text-ink-faint hidden border-b pb-2 md:grid md:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_9rem] md:gap-4">
        <ColumnLabel>Company</ColumnLabel>
        <span className="text-right text-[10px] tracking-[0.08em] uppercase">Market</span>
        <span className="text-right text-[10px] tracking-[0.08em] uppercase">NAV</span>
        <span className="text-right text-[10px] tracking-[0.08em] uppercase">Gap</span>
        <span className="text-right text-[10px] tracking-[0.08em] uppercase">Verdict</span>
      </div>

      <ul>
        {feed.tokens.map((token) => (
          <li key={token.symbol} className="border-hairline border-b last:border-b-0">
            <Link
              href={`/t/${token.symbol}`}
              className="hover:bg-surface-hover grid grid-cols-2 gap-x-4 gap-y-1 px-1 py-4 transition-colors duration-100 md:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_9rem] md:items-baseline md:gap-4"
            >
              {/* Company */}
              <div className="col-span-2 min-w-0 md:col-span-1">
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-ink text-sm font-medium">{token.symbol}</span>
                  {!token.tradable && (
                    <span className="border-hairline-strong text-ink-faint rounded-sm border px-1.5 py-0.5 text-[10px]">
                      not tradable
                    </span>
                  )}
                </div>
                <span className="text-ink-dim truncate text-xs">{displayName(token.name)}</span>
              </div>

              {/* Market */}
              <div className="md:text-right">
                <span className="md:hidden">
                  <ColumnLabel>Market</ColumnLabel>
                </span>
                <LivePrice value={token.tokenPrice} className="text-ink text-sm" />
              </div>

              {/* NAV */}
              <div className="md:text-right">
                <span className="md:hidden">
                  <ColumnLabel>NAV</ColumnLabel>
                </span>
                <LivePrice value={token.markPrice} className="text-ink-dim text-sm" />
              </div>

              {/* Gap */}
              <div className="md:text-right">
                <span className="md:hidden">
                  <ColumnLabel>Gap</ColumnLabel>
                </span>
                <GapValue premiumPct={token.premiumPct} className="text-sm font-medium" />
              </div>

              {/* Verdict */}
              <div className="md:text-right">
                <span className="md:hidden">
                  <ColumnLabel>Verdict</ColumnLabel>
                </span>
                <span className="text-ink-dim text-[11px] tracking-[0.04em]">
                  {VERDICT_LABEL[token.verdict]}
                </span>
                <span className="text-ink-faint tnum ml-2 text-[11px] md:ml-0 md:block">
                  {compactUsd(token.impliedValuation)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Skeleton that matches the row shape, so nothing shifts when data lands. */
function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading markets">
      <div className="mb-3 flex items-center gap-2">
        <span className="bg-hairline-strong inline-block h-1.5 w-1.5 rounded-full" />
        <span className="bg-hairline-strong inline-block h-2 w-28 rounded-sm" />
      </div>
      <ul>
        {Array.from({ length: 8 }).map((_, index) => (
          <li key={index} className="border-hairline border-b py-4">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_9rem] items-center gap-4">
              <div className="space-y-2">
                <span className="bg-hairline-strong block h-3 w-20 rounded-sm" />
                <span className="bg-hairline block h-2.5 w-28 rounded-sm" />
              </div>
              <span className="bg-hairline ml-auto block h-3 w-16 rounded-sm" />
              <span className="bg-hairline ml-auto block h-3 w-16 rounded-sm" />
              <span className="bg-hairline ml-auto block h-3 w-14 rounded-sm" />
              <span className="bg-hairline ml-auto block h-3 w-20 rounded-sm" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
