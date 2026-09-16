/** Read and control the signed-in user's alerts, automation and kill switch. */

import { z } from "zod";

import {
  cancelPolicy,
  listPolicies,
  listWatches,
  removeWatches,
  setPaused,
} from "@/lib/db/repositories";
import { currentUser, UnauthorizedError } from "@/lib/privy/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ linked: false, watches: [], policies: [] });

    const [watches, policies] = await Promise.all([
      listWatches(user.telegramId),
      listPolicies(user.telegramId),
    ]);

    return Response.json({
      linked: true,
      paused: user.paused,
      limits: {
        maxTradeUsdc: user.maxTradeUsdc,
        dailyCapUsdc: user.dailyCapUsdc,
        slippageBps: user.slippageBps,
      },
      watches: watches.map((w) => ({
        id: w.id,
        symbol: w.symbol,
        direction: w.direction,
        thresholdPct: w.thresholdPct,
      })),
      policies: policies.map((p) => ({
        id: p.id,
        kind: p.kind,
        symbol: p.symbol,
        thresholdPct: p.thresholdPct,
        amountUsdc: p.amountUsdc,
        amountToken: p.amountToken,
      })),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json({ error: "Failed to load automation" }, { status: 500 });
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancelPolicy"), id: z.number().int() }),
  z.object({ action: z.literal("cancelWatch"), symbol: z.string().min(1).max(32) }),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "No linked account" }, { status: 404 });

    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

    switch (parsed.data.action) {
      case "pause":
        await setPaused(user.telegramId, true);
        break;
      case "resume":
        await setPaused(user.telegramId, false);
        break;
      case "cancelPolicy":
        await cancelPolicy(user.telegramId, parsed.data.id);
        break;
      case "cancelWatch":
        await removeWatches(user.telegramId, parsed.data.symbol.toUpperCase());
        break;
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json({ error: "Action failed" }, { status: 500 });
  }
}
