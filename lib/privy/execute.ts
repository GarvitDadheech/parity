/**
 * The one path to spending a user's money.
 *
 * Every buy and sell in Parity — manual confirm, automated policy, dashboard
 * button — funnels through `executeSwap`. That is deliberate: the guardrails in
 * §10 of the spec are only real if there is no second route around them, so the
 * checks live here rather than in each caller.
 *
 * Order of operations, and why:
 *   1. Refuse if the user is paused or the signer was never authorized.
 *   2. Quote first, then check limits against the *quoted* size. Checking the
 *      requested size would let price movement between request and execution
 *      carry a trade past the cap.
 *   3. Write a pending Trade row before signing. If the process dies mid-send,
 *      the row is the evidence that something may have gone out.
 *   4. Sign, then confirm, then update the row.
 */

import { Connection, VersionedTransaction } from "@solana/web3.js";

import { config } from "@/lib/config";
import {
  createTrade,
  spentLast24h,
  updateTrade,
} from "@/lib/db/repositories";
import type { User } from "@/lib/generated/prisma";
import {
  buildSwapTransaction,
  getQuote,
  priceImpactPct,
  routeLabels,
  type JupiterQuote,
} from "@/lib/jupiter/client";
import { getConnection, SOLANA_MAINNET_CAIP2, USDC_MINT } from "@/lib/solana/connection";
import { getMintInfo, rawToUi, rawToUsdc, uiToRaw, usdcToRaw } from "@/lib/solana/mint";
import { getPreStockBalance, getUsdcBalance } from "@/lib/solana/balances";

import { authorizationContext, getPrivy } from "./server";

export type TradeKind = "manual_buy" | "manual_sell" | "auto_buy" | "auto_sell";

export interface SwapRequest {
  user: User;
  kind: TradeKind;
  symbol: string;
  mint: string;
  /** For buys: dollars to spend. */
  usdcAmount?: number;
  /** For sells: tokens to sell. Omit with sellAll to liquidate the position. */
  tokenAmount?: number;
  sellAll?: boolean;
  /** NAV gap at the moment this was decided — recorded as the trade's reason. */
  premiumAtExec: number;
}

export interface SwapResult {
  ok: boolean;
  tradeId?: number;
  signature?: string;
  dryRun: boolean;
  /** Human-readable explanation, suitable for sending straight to the chat. */
  message: string;
  quote?: QuoteSummary;
}

export interface QuoteSummary {
  inputLabel: string;
  outputLabel: string;
  usdcAmount: number;
  tokenAmount: number;
  /** Effective price per token implied by the quote. */
  executionPrice: number;
  priceImpactPct: number;
  slippageBps: number;
  route: string[];
}

/** A refusal that is expected and should be shown to the user, not logged as a crash. */
export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailError";
  }
}

/**
 * Price a swap without touching the signer.
 *
 * Used for the in-chat preview and the dashboard, and again inside executeSwap —
 * the preview a user confirms and the trade that runs are priced by identical code.
 */
export async function quoteSwap(params: {
  user: User;
  symbol: string;
  mint: string;
  usdcAmount?: number;
  tokenAmount?: number;
  sellAll?: boolean;
  side: "buy" | "sell";
}): Promise<{ quote: JupiterQuote; summary: QuoteSummary; tokenAmountResolved: number; usdcAmountResolved: number }> {
  const mintInfo = await getMintInfo(params.mint);

  if (mintInfo.paused) {
    throw new GuardrailError(
      `${params.symbol} transfers are currently paused by the issuer, so it cannot be traded right now.`,
    );
  }

  const slippageBps = params.user.slippageBps;

  if (params.side === "buy") {
    const usdcAmount = params.usdcAmount ?? 0;
    if (usdcAmount <= 0) throw new GuardrailError("Buy amount must be greater than zero.");

    const quote = await getQuote({
      inputMint: USDC_MINT,
      outputMint: params.mint,
      amount: usdcToRaw(usdcAmount),
      slippageBps,
    });

    const tokensOut = rawToUi(BigInt(quote.outAmount), mintInfo);
    return {
      quote,
      tokenAmountResolved: tokensOut,
      usdcAmountResolved: usdcAmount,
      summary: {
        inputLabel: `$${usdcAmount.toFixed(2)} USDC`,
        outputLabel: `${tokensOut.toFixed(6)} ${params.symbol}`,
        usdcAmount,
        tokenAmount: tokensOut,
        executionPrice: tokensOut > 0 ? usdcAmount / tokensOut : 0,
        priceImpactPct: priceImpactPct(quote),
        slippageBps,
        route: routeLabels(quote),
      },
    };
  }

  // Sell side. "all" is resolved against the live on-chain balance rather than
  // anything we believe locally, so it liquidates exactly what is there.
  let tokenAmount = params.tokenAmount ?? 0;
  if (params.sellAll) {
    if (!params.user.walletAddr) throw new GuardrailError("No wallet on file.");
    tokenAmount = await getPreStockBalance(params.user.walletAddr, params.mint);
  }
  if (tokenAmount <= 0) {
    throw new GuardrailError(`No ${params.symbol} balance to sell.`);
  }

  const quote = await getQuote({
    inputMint: params.mint,
    outputMint: USDC_MINT,
    amount: uiToRaw(tokenAmount, mintInfo),
    slippageBps,
  });

  const usdcOut = rawToUsdc(quote.outAmount);
  return {
    quote,
    tokenAmountResolved: tokenAmount,
    usdcAmountResolved: usdcOut,
    summary: {
      inputLabel: `${tokenAmount.toFixed(6)} ${params.symbol}`,
      outputLabel: `$${usdcOut.toFixed(2)} USDC`,
      usdcAmount: usdcOut,
      tokenAmount,
      executionPrice: tokenAmount > 0 ? usdcOut / tokenAmount : 0,
      priceImpactPct: priceImpactPct(quote),
      slippageBps,
      route: routeLabels(quote),
    },
  };
}

/**
 * Check the guardrails that Parity owns.
 *
 * Privy's own policy covers the program allowlist and the per-transaction
 * transfer cap. These are the ones it structurally cannot do: a rolling daily
 * window, a comparison against the user's live balance, and a price-impact
 * ceiling derived from the quote we are about to sign.
 */
async function assertWithinLimits(params: {
  user: User;
  kind: TradeKind;
  summary: QuoteSummary;
}): Promise<void> {
  const { user, summary } = params;
  const isBuy = params.kind === "manual_buy" || params.kind === "auto_buy";

  if (user.paused) {
    throw new GuardrailError("Execution is paused. Send /resume to re-enable trading.");
  }
  if (!user.signerActive || !user.walletId || !user.walletAddr) {
    throw new GuardrailError("Wallet is not set up yet. Send /login to finish onboarding.");
  }

  if (isBuy) {
    if (summary.usdcAmount > user.maxTradeUsdc) {
      throw new GuardrailError(
        `That trade is $${summary.usdcAmount.toFixed(2)}, above your per-trade cap of $${user.maxTradeUsdc.toFixed(2)}.`,
      );
    }

    const alreadySpent = await spentLast24h(user.telegramId);
    if (alreadySpent + summary.usdcAmount > user.dailyCapUsdc) {
      throw new GuardrailError(
        `That trade would take today's spend to $${(alreadySpent + summary.usdcAmount).toFixed(2)}, ` +
          `above your daily cap of $${user.dailyCapUsdc.toFixed(2)}.`,
      );
    }

    const balance = await getUsdcBalance(user.walletAddr);
    if (balance < summary.usdcAmount) {
      throw new GuardrailError(
        `Not enough USDC: the wallet holds $${balance.toFixed(2)} and this needs $${summary.usdcAmount.toFixed(2)}.`,
      );
    }
  }

  // Price impact is a different thing from slippage tolerance — it is the cost
  // the route imposes right now, before any market movement. Signing a quote
  // whose impact already exceeds the user's tolerance would honour the letter of
  // their slippage setting while ignoring its point.
  const impactBps = summary.priceImpactPct * 100;
  if (impactBps > summary.slippageBps) {
    throw new GuardrailError(
      `Price impact is ${summary.priceImpactPct.toFixed(2)}%, above your ${(summary.slippageBps / 100).toFixed(2)}% limit. ` +
        "Try a smaller size.",
    );
  }
}

async function confirmSignature(connection: Connection, signature: string): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) return false;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

export async function executeSwap(request: SwapRequest): Promise<SwapResult> {
  const side: "buy" | "sell" =
    request.kind === "manual_buy" || request.kind === "auto_buy" ? "buy" : "sell";

  const { quote, summary, tokenAmountResolved, usdcAmountResolved } = await quoteSwap({
    user: request.user,
    symbol: request.symbol,
    mint: request.mint,
    usdcAmount: request.usdcAmount,
    tokenAmount: request.tokenAmount,
    sellAll: request.sellAll,
    side,
  });

  await assertWithinLimits({ user: request.user, kind: request.kind, summary });

  const dryRun = config.dryRun();

  // The row goes in before anything irreversible happens.
  const trade = await createTrade({
    telegramId: request.user.telegramId,
    kind: request.kind,
    symbol: request.symbol,
    usdcAmount: usdcAmountResolved,
    tokenAmount: tokenAmountResolved,
    premiumAtExec: request.premiumAtExec,
    status: dryRun ? "dry_run" : "pending",
    dryRun,
  });

  if (dryRun) {
    return {
      ok: true,
      tradeId: trade.id,
      dryRun: true,
      quote: summary,
      message:
        `DRY RUN — nothing was executed. Would have swapped ${summary.inputLabel} → ${summary.outputLabel} ` +
        `at ${summary.priceImpactPct.toFixed(2)}% price impact via ${summary.route.join(" + ") || "Jupiter"}.`,
    };
  }

  try {
    const { swapTransaction } = await buildSwapTransaction({
      quote,
      userPublicKey: request.user.walletAddr!,
    });

    const privy = getPrivy();
    const { hash } = await privy
      .wallets()
      .solana()
      .signAndSendTransaction(request.user.walletId!, {
        caip2: SOLANA_MAINNET_CAIP2,
        transaction: swapTransaction,
        authorization_context: authorizationContext(),
      });

    await updateTrade(trade.id, { txSig: hash });

    const confirmed = await confirmSignature(getConnection(), hash);
    await updateTrade(trade.id, { status: confirmed ? "confirmed" : "failed" });

    return {
      ok: confirmed,
      tradeId: trade.id,
      signature: hash,
      dryRun: false,
      quote: summary,
      message: confirmed
        ? `Swapped ${summary.inputLabel} → ${summary.outputLabel}.`
        : "The transaction was sent but did not confirm. Check the signature on Solscan before retrying.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTrade(trade.id, { status: "failed", error: message.slice(0, 500) });
    return {
      ok: false,
      tradeId: trade.id,
      dryRun: false,
      quote: summary,
      message: `Execution failed: ${message}`,
    };
  }
}

/** Kept for callers that want to decode a built transaction for inspection. */
export function decodeTransaction(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
}
