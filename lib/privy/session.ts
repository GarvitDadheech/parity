/**
 * Identifying the person behind a dashboard request.
 *
 * The dashboard is the secondary surface — Telegram is where users live — so
 * rather than running a second session system, a page presents the Privy
 * identity token and the server hands it to Privy for verification. The token is
 * the only thing trusted; nothing reads a user id out of a request body.
 */

import type { User as PrivyUser } from "@privy-io/node";

import { prisma } from "@/lib/db/client";
import type { User } from "@/lib/generated/prisma";

import { getPrivy } from "./server";

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Pull the bearer token a dashboard fetch attaches. */
export function identityTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/**
 * Verify a Privy token and return the user it describes.
 *
 * Prefers the **access token**, because every logged-in session has one. The
 * identity token is optional in Privy and an app can be configured without it,
 * which previously left the authorize step permanently disabled with no
 * explanation. Access tokens carry only a user id, so the linked accounts are
 * then read from Privy's own record rather than from anything the client said.
 *
 * Verification is done by the SDK against the app's JWKS, so a forged or expired
 * token fails here instead of being taken at face value.
 */
export async function verifiedPrivyUser(token: string): Promise<PrivyUser> {
  const privy = getPrivy();

  try {
    const claims = await privy.utils().auth().verifyAccessToken(token);
    return await privy.users()._get(claims.user_id);
  } catch {
    // Fall through: the caller may legitimately have sent an identity token.
  }

  try {
    return await privy.users().get({ id_token: token });
  } catch {
    throw new UnauthorizedError("Your session could not be verified. Sign in again.");
  }
}

export async function resolvePrivyUser(request: Request): Promise<PrivyUser> {
  const token = identityTokenFrom(request);
  if (!token) throw new UnauthorizedError();
  return verifiedPrivyUser(token);
}

/**
 * The Parity account for the signed-in Privy user.
 *
 * Returns null rather than throwing when the Privy account is valid but has
 * never been linked from Telegram — that is a normal state with its own UI, not
 * an error.
 */
export async function currentUser(request: Request): Promise<User | null> {
  const privyUser = await resolvePrivyUser(request);
  return prisma.user.findUnique({ where: { privyUserId: privyUser.id } });
}
