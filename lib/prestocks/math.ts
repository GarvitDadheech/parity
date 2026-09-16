/**
 * The single source of truth for Parity's core number.
 *
 * Every PreStock has two prices: `markPrice`, the backed fair value from its 1:1
 * SPV, and `tokenPrice`, what it actually trades for on Solana. The gap between
 * them is the entire product, so it is computed in exactly one place and every
 * surface — dashboard, bot, trigger engine — reads it from here.
 */

import type { PreStock, PreStockRaw, Verdict } from "./types";

/**
 * Verdict cut-offs in percent. Tuned to be legible rather than clever: a 3% band
 * around fair value is noise, 10% is where a gap starts to look like a thesis.
 */
export const VERDICT_THRESHOLDS = {
  deepDiscount: -10,
  discount: -3,
  premium: 3,
  highPremium: 10,
} as const;

/**
 * How far the gap must retreat past a rule's threshold before that rule re-arms.
 *
 * Without this, a token sitting at exactly -15% against a -15% rule would fire,
 * un-fire and re-fire on every poll. Three points of hysteresis is the
 * difference between an alert you trust and one you mute.
 */
export const HYSTERESIS_PCT = 3;

/**
 * Positive = trading above fair value (paying a premium).
 * Negative = trading below fair value (buying at a discount).
 */
export function premiumPct(token: Pick<PreStockRaw, "markPrice" | "tokenPrice">): number {
  if (!Number.isFinite(token.markPrice) || token.markPrice === 0) return 0;
  return ((token.tokenPrice - token.markPrice) / token.markPrice) * 100;
}

export function verdictFor(premium: number): Verdict {
  if (premium <= VERDICT_THRESHOLDS.deepDiscount) return "DEEP_DISCOUNT";
  if (premium <= VERDICT_THRESHOLDS.discount) return "DISCOUNT";
  if (premium < VERDICT_THRESHOLDS.premium) return "FAIR";
  if (premium < VERDICT_THRESHOLDS.highPremium) return "PREMIUM";
  return "HIGH_PREMIUM";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  DEEP_DISCOUNT: "DEEP DISCOUNT",
  DISCOUNT: "DISCOUNT",
  FAIR: "FAIR",
  PREMIUM: "PREMIUM",
  HIGH_PREMIUM: "HIGH PREMIUM",
};

/** Green for a discount, red for a premium, neutral at fair value — everywhere. */
export type GapTone = "discount" | "premium" | "neutral";

export function toneFor(premium: number): GapTone {
  if (premium <= VERDICT_THRESHOLDS.discount) return "discount";
  if (premium >= VERDICT_THRESHOLDS.premium) return "premium";
  return "neutral";
}

export function enrich(raw: PreStockRaw): PreStock {
  const premium = premiumPct(raw);
  return { ...raw, premiumPct: premium, verdict: verdictFor(premium) };
}

/**
 * Does a rule fire at this gap?
 *
 * Thresholds are always given as a positive magnitude — "alert me at 15% below
 * fair value" is `direction: "discount", thresholdPct: 15`, which fires when the
 * premium is at or below -15. Keeping the sign convention in one function stops
 * it leaking into the bot's argument parsing and the trigger engine separately.
 */
export function ruleTriggered(
  direction: "discount" | "premium",
  thresholdPct: number,
  premium: number,
): boolean {
  const magnitude = Math.abs(thresholdPct);
  return direction === "discount" ? premium <= -magnitude : premium >= magnitude;
}

/**
 * Has the gap retreated far enough for the rule to re-arm?
 *
 * A discount rule armed at 15% only re-arms once the discount is shallower than
 * 12%, so a token oscillating around 15% fires once, not once per tick.
 */
export function ruleRearmed(
  direction: "discount" | "premium",
  thresholdPct: number,
  premium: number,
): boolean {
  const magnitude = Math.abs(thresholdPct);
  const band = Math.max(0, magnitude - HYSTERESIS_PCT);
  return direction === "discount" ? premium > -band : premium < band;
}

/**
 * What a position is worth at fair value versus what the market says today.
 *
 * This is the P&L number Parity actually cares about: not what you paid, but how
 * far the market still is from the backing. `navUpside` is how much the position
 * would gain if the gap closed completely — which is a possibility, not a promise.
 */
export function positionGap(params: {
  tokens: number;
  markPrice: number;
  tokenPrice: number;
}) {
  const marketValue = params.tokens * params.tokenPrice;
  const navValue = params.tokens * params.markPrice;
  return {
    marketValue,
    navValue,
    navUpside: navValue - marketValue,
    premiumPct: premiumPct(params),
  };
}
