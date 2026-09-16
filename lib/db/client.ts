/**
 * Prisma client singleton.
 *
 * Prisma 7 takes its connection through a driver adapter rather than a URL in
 * the schema, so the pool is constructed here. In development the instance is
 * stashed on `globalThis` because hot reload would otherwise open a new pool on
 * every edit until Postgres refuses connections.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma";

declare global {
  var __parityPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Parity's public dashboard works without a database, " +
        "but accounts, alerts, policies and trade history all need one.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalThis.__parityPrisma ?? (globalThis.__parityPrisma = createClient());

if (process.env.NODE_ENV !== "production") {
  globalThis.__parityPrisma = prisma;
}

/** True when a database is configured at all — lets read-only pages degrade gracefully. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
