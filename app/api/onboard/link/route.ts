/**
 * Completes onboarding: ties a Privy wallet to a Telegram chat.
 *
 * The browser sends the onboarding token from the bot's link plus the Privy
 * identity token for the logged-in user. The identity token is verified
 * server-side — the client is never trusted to assert who it is, because that
 * claim is what decides whose wallet the server signer will act on. The wallet
 * itself is then read from Privy's own record of that user rather than from the
 * request body, so a caller cannot point their Telegram account at someone
 * else's wallet.
 */

import { z } from "zod";

import { config } from "@/lib/config";
import { getUserByOnboardToken, linkWallet } from "@/lib/db/repositories";
import { notifyUser } from "@/bot/notify";
import { onboardedMessage } from "@/bot/messages/onboarded";
import { findSolanaWallet, privyConfigured } from "@/lib/privy/server";
import { verifiedPrivyUser } from "@/lib/privy/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  onboardToken: z.string().min(8),
  identityToken: z.string().min(8),
  limits: z
    .object({
      maxTradeUsdc: z.number().positive().max(10_000),
      dailyCapUsdc: z.number().positive().max(50_000),
      slippageBps: z.number().int().min(10).max(500),
      maxPriceImpactBps: z.number().int().min(10).max(2000).optional(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (!privyConfigured()) {
    return Response.json({ error: "Privy is not configured on the server." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { onboardToken, identityToken, limits } = parsed.data;

  const user = await getUserByOnboardToken(onboardToken);
  if (!user) {
    return Response.json(
      { error: "This onboarding link is no longer valid. Send /login in Telegram for a fresh one." },
      { status: 404 },
    );
  }

  // Verify the identity token rather than believing the body. Privy does the
  // JWKS check and hands back the user record, so the wallet we act on is the
  // one Privy says belongs to this session — not one named in the request.
  let privyUser;
  try {
    privyUser = await verifiedPrivyUser(identityToken);
  } catch {
    return Response.json({ error: "Could not verify your Privy session." }, { status: 401 });
  }

  const wallet = findSolanaWallet(privyUser);
  if (!wallet) {
    return Response.json(
      { error: "No embedded Solana wallet found on this Privy account yet." },
      { status: 409 },
    );
  }

  // The client grants the signer before calling this endpoint, so a wallet that
  // still reports no delegation means the grant silently failed. Recording the
  // user as ready to trade at that point would arm policies that cannot execute.
  if (!wallet.delegated) {
    return Response.json(
      {
        error:
          "The signer was not granted on this wallet. Try the authorize step again — " +
          "Parity will not mark you ready to trade until it is.",
      },
      { status: 409 },
    );
  }

  const linked = await linkWallet({
    telegramId: user.telegramId,
    privyUserId: privyUser.id,
    walletId: wallet.walletId,
    walletAddr: wallet.address,
    maxTradeUsdc: limits?.maxTradeUsdc,
    dailyCapUsdc: limits?.dailyCapUsdc,
    slippageBps: limits?.slippageBps,
    maxPriceImpactBps: limits?.maxPriceImpactBps,
  });

  // Hand the user back to the chat they came from. This is deliberately after
  // the wallet is linked and deliberately non-fatal: the setup already
  // succeeded, so a Telegram hiccup must not report it as a failure.
  const notified = await notifyUser(
    user.telegramId,
    onboardedMessage({
      walletAddress: wallet.address,
      maxTradeUsdc: linked.maxTradeUsdc,
      dailyCapUsdc: linked.dailyCapUsdc,
      slippageBps: linked.slippageBps,
      maxPriceImpactBps: linked.maxPriceImpactBps,
      dryRun: config.dryRun(),
    }),
  );

  return Response.json({
    notified: notified.sent,
    ok: true,
    walletAddress: wallet.address,
    telegramLinked: true,
    botUsername: config.telegram.botUsername() ?? null,
  });
}
