/** Tells the onboarding page which Telegram account a link belongs to. */

import { getUserByOnboardToken } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return Response.json({ error: "Missing token" }, { status: 400 });

  const user = await getUserByOnboardToken(token).catch(() => null);
  if (!user) {
    return Response.json({ valid: false }, { status: 404 });
  }

  return Response.json({
    valid: true,
    alreadyConnected: user.signerActive,
    walletAddress: user.walletAddr,
    limits: {
      maxTradeUsdc: user.maxTradeUsdc,
      dailyCapUsdc: user.dailyCapUsdc,
      slippageBps: user.slippageBps,
      maxPriceImpactBps: user.maxPriceImpactBps,
    },
  });
}
