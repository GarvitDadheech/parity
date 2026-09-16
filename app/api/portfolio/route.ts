/** Holdings, cash and trade history for the signed-in user. */

import { listTrades, spentLast24h } from "@/lib/db/repositories";
import { fetchPreStocks } from "@/lib/prestocks/client";
import { positionGap } from "@/lib/prestocks/math";
import { currentUser, UnauthorizedError } from "@/lib/privy/session";
import { getSolBalance, getTokenBalances, getUsdcBalance } from "@/lib/solana/balances";
import { getMintInfo, rawToUi } from "@/lib/solana/mint";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await currentUser(request);
    if (!user) {
      return Response.json({ linked: false, positions: [], trades: [] });
    }
    if (!user.walletAddr) {
      return Response.json({ linked: true, walletAddress: null, positions: [], trades: [] });
    }

    const [tokens, balances, usdc, sol, trades, spentToday] = await Promise.all([
      fetchPreStocks(),
      getTokenBalances(user.walletAddr),
      getUsdcBalance(user.walletAddr),
      getSolBalance(user.walletAddr),
      listTrades(user.telegramId, 25),
      spentLast24h(user.telegramId),
    ]);

    const positions = [];
    for (const token of tokens) {
      const held = balances.get(token.contract_address);
      if (!held || held.raw === "0") continue;

      const info = await getMintInfo(token.contract_address);
      const amount = rawToUi(BigInt(held.raw), info);
      if (amount <= 0) continue;

      const gap = positionGap({
        tokens: amount,
        markPrice: token.markPrice,
        tokenPrice: token.tokenPrice,
      });

      positions.push({
        symbol: token.symbol,
        name: token.name,
        mint: token.contract_address,
        tokens: amount,
        markPrice: token.markPrice,
        tokenPrice: token.tokenPrice,
        ...gap,
      });
    }

    positions.sort((a, b) => b.marketValue - a.marketValue);

    return Response.json({
      linked: true,
      walletAddress: user.walletAddr,
      paused: user.paused,
      signerActive: user.signerActive,
      limits: {
        maxTradeUsdc: user.maxTradeUsdc,
        dailyCapUsdc: user.dailyCapUsdc,
        slippageBps: user.slippageBps,
        maxPriceImpactBps: user.maxPriceImpactBps,
        spentToday,
      },
      cash: { usdc, sol },
      positions,
      trades: trades.map((trade) => ({
        id: trade.id,
        kind: trade.kind,
        symbol: trade.symbol,
        usdcAmount: trade.usdcAmount,
        tokenAmount: trade.tokenAmount,
        premiumAtExec: trade.premiumAtExec,
        txSig: trade.txSig,
        status: trade.status,
        dryRun: trade.dryRun,
        createdAt: trade.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load portfolio" },
      { status: 500 },
    );
  }
}
