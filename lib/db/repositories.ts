/**
 * Data access for Parity.
 *
 * Kept in one module so the bot, the dashboard and the trigger engine all reach
 * the database through identical queries — in particular the daily-spend
 * calculation, which is a safety control and must not have two implementations.
 */

import type { Prisma, Trade, User } from "@/lib/generated/prisma";

import { prisma } from "./client";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUser(telegramId: bigint): Promise<User | null> {
  return prisma.user.findUnique({ where: { telegramId } });
}

export async function ensureUser(telegramId: bigint): Promise<User> {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

export async function setOnboardToken(telegramId: bigint, token: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { onboardToken: token } });
}

export async function getUserByOnboardToken(token: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { onboardToken: token } });
}

/** Called when the web onboarding completes and the signer has been authorized. */
export async function linkWallet(params: {
  telegramId: bigint;
  privyUserId: string;
  walletId: string;
  walletAddr: string;
  maxTradeUsdc?: number;
  dailyCapUsdc?: number;
  slippageBps?: number;
  maxPriceImpactBps?: number;
}): Promise<User> {
  return prisma.user.update({
    where: { telegramId: params.telegramId },
    data: {
      privyUserId: params.privyUserId,
      walletId: params.walletId,
      walletAddr: params.walletAddr,
      signerActive: true,
      ...(params.maxTradeUsdc !== undefined ? { maxTradeUsdc: params.maxTradeUsdc } : {}),
      ...(params.dailyCapUsdc !== undefined ? { dailyCapUsdc: params.dailyCapUsdc } : {}),
      ...(params.slippageBps !== undefined ? { slippageBps: params.slippageBps } : {}),
      ...(params.maxPriceImpactBps !== undefined
        ? { maxPriceImpactBps: params.maxPriceImpactBps }
        : {}),
    },
  });
}

export async function setPaused(telegramId: bigint, paused: boolean): Promise<User> {
  return prisma.user.update({ where: { telegramId }, data: { paused } });
}

export async function updateLimits(
  telegramId: bigint,
  limits: {
    maxTradeUsdc?: number;
    dailyCapUsdc?: number;
    slippageBps?: number;
    maxPriceImpactBps?: number;
  },
): Promise<User> {
  return prisma.user.update({ where: { telegramId }, data: limits });
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface PriceRow {
  symbol: string;
  markPrice: number;
  tokenPrice: number;
  premiumPct: number;
  mint?: string;
  name?: string;
  tradable?: boolean;
}

/**
 * Persist one poll tick: update the current price per symbol and append to history.
 *
 * Both happen in a single transaction so the history can never contain a point
 * that the live table disagrees with.
 */
export async function recordPrices(rows: PriceRow[]): Promise<void> {
  await prisma.$transaction([
    ...rows.map((row) =>
      prisma.latestPrice.upsert({
        where: { symbol: row.symbol },
        create: {
          symbol: row.symbol,
          markPrice: row.markPrice,
          tokenPrice: row.tokenPrice,
          premiumPct: row.premiumPct,
          mint: row.mint,
          name: row.name,
          tradable: row.tradable ?? true,
        },
        update: {
          markPrice: row.markPrice,
          tokenPrice: row.tokenPrice,
          premiumPct: row.premiumPct,
          mint: row.mint,
          name: row.name,
          ...(row.tradable !== undefined ? { tradable: row.tradable } : {}),
        },
      }),
    ),
    prisma.priceSnapshot.createMany({
      data: rows.map((row) => ({
        symbol: row.symbol,
        markPrice: row.markPrice,
        tokenPrice: row.tokenPrice,
        premiumPct: row.premiumPct,
      })),
    }),
  ]);
}

export async function getLatestPrice(symbol: string) {
  return prisma.latestPrice.findUnique({ where: { symbol } });
}

export async function getPriceHistory(symbol: string, since: Date) {
  return prisma.priceSnapshot.findMany({
    where: { symbol, ts: { gte: since } },
    orderBy: { ts: "asc" },
    select: { ts: true, markPrice: true, tokenPrice: true, premiumPct: true },
  });
}

// ---------------------------------------------------------------------------
// Watches and policies
// ---------------------------------------------------------------------------

export async function addWatch(params: {
  telegramId: bigint;
  symbol: string;
  direction: "discount" | "premium";
  thresholdPct: number;
}) {
  // Replace any existing watch on the same symbol and direction rather than
  // stacking duplicates that would all fire at once.
  await prisma.watch.updateMany({
    where: { telegramId: params.telegramId, symbol: params.symbol, direction: params.direction, active: true },
    data: { active: false },
  });
  return prisma.watch.create({ data: { ...params, active: true } });
}

export async function removeWatches(telegramId: bigint, symbol: string): Promise<number> {
  const { count } = await prisma.watch.updateMany({
    where: { telegramId, symbol, active: true },
    data: { active: false },
  });
  return count;
}

export async function listWatches(telegramId: bigint) {
  return prisma.watch.findMany({
    where: { telegramId, active: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function addPolicy(params: {
  telegramId: bigint;
  kind: "autobuy" | "autosell";
  symbol: string;
  thresholdPct: number;
  amountUsdc?: number | null;
  amountToken?: number | null;
}) {
  return prisma.policy.create({ data: { ...params, active: true } });
}

export async function listPolicies(telegramId: bigint) {
  return prisma.policy.findMany({
    where: { telegramId, active: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function cancelPolicy(telegramId: bigint, id: number): Promise<boolean> {
  const { count } = await prisma.policy.updateMany({
    where: { id, telegramId, active: true },
    data: { active: false },
  });
  return count > 0;
}

/** Every armed rule across all users, for one poll tick. */
export async function loadActiveRules() {
  const [watches, policies] = await Promise.all([
    prisma.watch.findMany({ where: { active: true }, include: { user: true } }),
    prisma.policy.findMany({ where: { active: true }, include: { user: true } }),
  ]);
  return { watches, policies };
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export async function createTrade(data: Prisma.TradeUncheckedCreateInput): Promise<Trade> {
  return prisma.trade.create({ data });
}

export async function updateTrade(id: number, data: Prisma.TradeUncheckedUpdateInput): Promise<Trade> {
  return prisma.trade.update({ where: { id }, data });
}

export async function listTrades(telegramId: bigint, take = 50) {
  return prisma.trade.findMany({ where: { telegramId }, orderBy: { createdAt: "desc" }, take });
}

/**
 * Dollars this user has spent on buys in the last 24 hours.
 *
 * Counts pending rows as well as confirmed ones: a trade in flight has already
 * committed the money, and excluding it would let a burst of triggers blow
 * through the daily cap before any of them settled. Failed trades are excluded
 * because nothing was spent. Dry runs are excluded because nothing was real.
 */
export async function spentLast24h(telegramId: bigint): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.trade.aggregate({
    where: {
      telegramId,
      createdAt: { gte: since },
      dryRun: false,
      status: { in: ["pending", "confirmed"] },
      kind: { in: ["manual_buy", "auto_buy"] },
    },
    _sum: { usdcAmount: true },
  });
  return result._sum.usdcAmount ?? 0;
}

// ---------------------------------------------------------------------------
// Pending manual trades (preview -> confirm)
// ---------------------------------------------------------------------------

export async function createPendingTrade(data: {
  id: string;
  telegramId: bigint;
  kind: string;
  symbol: string;
  mint: string;
  usdcAmount?: number | null;
  tokenAmount?: number | null;
  quotedPrice: number;
  premiumPct: number;
  expiresAt: Date;
}) {
  return prisma.pendingTrade.create({ data });
}

/**
 * Claim a pending trade, deleting it in the same step.
 *
 * Deleting on read is what makes a double-tap of Confirm harmless: the second
 * press finds nothing and reports an expired preview instead of trading twice.
 */
export async function claimPendingTrade(id: string, telegramId: bigint) {
  try {
    return await prisma.pendingTrade.delete({ where: { id, telegramId } });
  } catch {
    return null;
  }
}

export async function purgeExpiredPendingTrades(): Promise<void> {
  await prisma.pendingTrade.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
