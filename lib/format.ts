/**
 * Number and text formatting.
 *
 * Numbers are the product, so they are formatted in exactly one place. Two rules
 * hold everywhere: a signed percentage always carries its sign so a discount can
 * never be mistaken for a premium at a glance, and prices keep two decimals even
 * when round, so columns of figures line up.
 */

export function usd(value: number, decimals = 2): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Always signed. A leading "+" is what distinguishes a premium from a discount. */
export function signedPct(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

export function pct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/** Compact valuations: $1.89T, $38.7B. */
export function compactUsd(value: number): string {
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      return `$${(value / size).toFixed(abs / size >= 100 ? 0 : 2)}${suffix}`;
    }
  }
  return usd(value);
}

/**
 * Token quantities. These can be very small — a $50 buy of a $1,000 token is
 * 0.05 tokens — so significant digits matter more than a fixed decimal count.
 */
export function tokenAmount(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.0001) return value.toFixed(6);
  return value.toExponential(2);
}

export function shortAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function timeAgo(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The disclaimer that has to accompany every piece of money copy. */
export const DISCLAIMER =
  "Not financial advice. A discount to fair value does not guarantee a profit.";
