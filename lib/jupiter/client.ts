/**
 * Jupiter aggregator integration.
 *
 * A note on the endpoint: the v6 API the original specification assumed
 * (`quote-api.jup.ag/v6`) no longer answers. The live free endpoint is
 * `lite-api.jup.ag/swap/v1`, which is what Parity uses; `api.jup.ag/swap/v1` is
 * the same surface behind an API key and can be swapped in via JUPITER_API_URL
 * if rate limits bite.
 */

import { USDC_MINT } from "@/lib/solana/connection";

const JUPITER_BASE = process.env.JUPITER_API_URL ?? "https://lite-api.jup.ag/swap/v1";

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo?: { label?: string }; percent?: number }>;
  contextSlot?: number;
  /** Jupiter's own dollar valuation of the swap — a useful sanity check. */
  swapUsdValue?: string;
  [key: string]: unknown;
}

export class NoRouteError extends Error {
  constructor(public readonly mint: string, message?: string) {
    super(message ?? `Jupiter has no route for ${mint}`);
    this.name = "NoRouteError";
  }
}

async function jupiterFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = process.env.JUPITER_API_KEY;
  return fetch(`${JUPITER_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...init?.headers,
    },
  });
}

/**
 * Fetch a quote. `amount` is the raw integer amount of `inputMint`.
 *
 * Callers must have already converted through the mint's scaled-UI multiplier —
 * Jupiter deals only in raw units and has no idea what a human meant.
 */
export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
}): Promise<JupiterQuote> {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: String(params.slippageBps),
  });

  const response = await jupiterFetch(`/quote?${query.toString()}`);
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok || !body || typeof body !== "object" || !("outAmount" in body)) {
    const detail =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new NoRouteError(params.outputMint, `No Jupiter route: ${detail}`);
  }

  return body as JupiterQuote;
}

/**
 * Turn a quote into a serialized transaction for the given wallet.
 *
 * `dynamicSlippage` is deliberately off: Parity enforces the user's slippage cap
 * itself, and letting Jupiter widen it at send time would silently exceed the
 * limit the user agreed to at onboarding.
 */
export async function buildSwapTransaction(params: {
  quote: JupiterQuote;
  userPublicKey: string;
}): Promise<{ swapTransaction: string; lastValidBlockHeight?: number }> {
  const response = await jupiterFetch("/swap", {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: params.quote,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: "high", maxLamports: 1_000_000 } },
    }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok || !body || typeof body !== "object" || !("swapTransaction" in body)) {
    const detail =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(`Jupiter could not build the swap transaction: ${detail}`);
  }

  return body as { swapTransaction: string; lastValidBlockHeight?: number };
}

/** Realised price impact of a quote, as a percentage. */
export function priceImpactPct(quote: JupiterQuote): number {
  const value = Number(quote.priceImpactPct);
  return Number.isFinite(value) ? value * 100 : 0;
}

/** Which venues the route goes through — shown in the trade preview. */
export function routeLabels(quote: JupiterQuote): string[] {
  return quote.routePlan
    .map((leg) => leg.swapInfo?.label)
    .filter((label): label is string => Boolean(label));
}

/**
 * Probe whether a mint is tradable at all, used to mark tokens in the UI.
 *
 * A mint that does not route is labelled "not tradable" rather than hidden — a
 * user who cannot find their token has no way to tell a bug from a missing
 * market.
 */
export async function isTradable(mint: string): Promise<boolean> {
  try {
    await getQuote({
      inputMint: USDC_MINT,
      outputMint: mint,
      amount: 10_000_000n, // $10, large enough to route and small enough to be honest
      slippageBps: 100,
    });
    return true;
  } catch {
    return false;
  }
}
