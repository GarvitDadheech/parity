"use client";

import { useEffect, useRef, useState } from "react";

import { signedPct, usd } from "@/lib/format";

export type Tone = "discount" | "premium" | "neutral";

export function toneClass(tone: Tone): string {
  if (tone === "discount") return "text-discount";
  if (tone === "premium") return "text-premium";
  return "text-ink-dim";
}

/**
 * A price that acknowledges when it changes.
 *
 * The flash is the only thing on the page that moves on its own, and it is
 * information rather than decoration: in a table of live prices you need to know
 * which figure just moved and in which direction. It fades back to neutral after
 * a beat so the colour never gets stuck and misreports a stale state.
 */
export function LivePrice({
  value,
  decimals = 2,
  className = "",
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const previous = useRef(value);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (value === previous.current) return;
    setDirection(value > previous.current ? "up" : "down");
    previous.current = value;
    const timer = setTimeout(() => setDirection(null), 700);
    return () => clearTimeout(timer);
  }, [value]);

  const flash =
    direction === "up" ? "text-discount" : direction === "down" ? "text-premium" : "";

  return (
    <span className={`tnum transition-colors duration-500 ${flash} ${className}`}>
      {usd(value, decimals)}
    </span>
  );
}

/**
 * The gap to fair value — the number the whole product exists to show.
 *
 * Always signed, so a discount can never be misread as a premium at a glance.
 */
export function GapValue({
  premiumPct,
  className = "",
  decimals = 2,
}: {
  premiumPct: number;
  className?: string;
  decimals?: number;
}) {
  const tone: Tone = premiumPct <= -3 ? "discount" : premiumPct >= 3 ? "premium" : "neutral";
  return (
    <span className={`tnum ${toneClass(tone)} ${className}`}>{signedPct(premiumPct, decimals)}</span>
  );
}

/** Small uppercase column label. Used everywhere a number needs naming. */
export function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-ink-faint block text-[10px] font-medium tracking-[0.08em] uppercase">
      {children}
    </span>
  );
}
