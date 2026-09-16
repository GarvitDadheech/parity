"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usd } from "@/lib/format";

interface Point {
  ts: string;
  markPrice: number;
  tokenPrice: number;
  premiumPct: number;
}

/**
 * NAV against market price over time.
 *
 * Two lines, deliberately: the whole story is the distance between them, and a
 * single "premium %" line would hide whether the gap moved because the market
 * fell or because the backing rose.
 */
export function NavChart({ symbol }: { symbol: string }) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&hours=24`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`History returned ${response.status}`);
        const data: { points: Point[] } = await response.json();
        if (!cancelled) setPoints(data.points);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load history");
      }
    }

    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol]);

  if (error) {
    return (
      <div className="border-hairline text-ink-dim flex h-64 items-center justify-center rounded-sm border px-5 text-center text-xs">
        {error}
      </div>
    );
  }

  if (points === null) {
    return (
      <div
        className="border-hairline h-64 animate-pulse rounded-sm border"
        aria-busy="true"
        aria-label="Loading price history"
      />
    );
  }

  if (points.length < 2) {
    return (
      <div className="border-hairline flex h-64 flex-col items-center justify-center gap-2 rounded-sm border px-5 text-center">
        <p className="text-ink text-sm">No history yet.</p>
        <p className="text-ink-dim max-w-prose text-xs leading-relaxed">
          Parity records a snapshot on every poll. This chart fills in as soon as the trigger
          engine has been running for a few minutes.
        </p>
      </div>
    );
  }

  const data = points.map((point) => ({
    ...point,
    label: new Date(point.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1c1c20" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#5a5a62"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#1c1c20" }}
            minTickGap={40}
          />
          <YAxis
            stroke="#5a5a62"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={["auto", "auto"]}
            tickFormatter={(value: number) => usd(value, 0)}
          />
          <Tooltip
            contentStyle={{
              background: "#0e0e10",
              border: "1px solid #2a2a30",
              borderRadius: 2,
              fontSize: 11,
            }}
            labelStyle={{ color: "#8e8e96" }}
            formatter={(value, name) => [
              usd(Number(value)),
              name === "markPrice" ? "NAV" : "Market",
            ]}
          />
          <Line
            type="monotone"
            dataKey="markPrice"
            stroke="#8e8e96"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="tokenPrice"
            stroke="#e0a43c"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="text-ink-faint mt-3 flex items-center gap-5 text-[10px]">
        <span className="flex items-center gap-2">
          <span className="bg-accent inline-block h-px w-4" aria-hidden="true" />
          Market price
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-px w-4 border-t border-dashed border-ink-dim" aria-hidden="true" />
          NAV (backed fair value)
        </span>
      </div>
    </div>
  );
}
