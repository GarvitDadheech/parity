/**
 * Prisma client singleton.
 *
 * Prisma 7 takes its connection through a driver adapter rather than a URL in
 * the schema, so the pool is constructed here.
 *
 * The client is created lazily, on first query rather than on import. Parity's
 * public dashboard is meant to work with no database at all — it reads the live
 * PreStocks feed and nothing else — and eagerly constructing the pool would make
 * merely importing this module throw on a deployment that has not been given a
 * DATABASE_URL yet. Lazy construction keeps that promise honest.
 *
 * In development the instance is stashed on `globalThis` because hot reload
 * would otherwise open a new pool on every edit until Postgres refuses
 * connections.
 */

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma";

declare global {
  var __parityPrisma: PrismaClient | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Parity's public dashboard works without a database, " +
        "but accounts, alerts, policies and trade history all need one.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function client(): PrismaClient {
  if (!globalThis.__parityPrisma) {
    globalThis.__parityPrisma = createClient();
  }
  return globalThis.__parityPrisma;
}

/**
 * A stand-in that builds the real client on first property access, so importing
 * this module is always safe and only *using* it requires configuration.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(client(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(client(), property);
  },
});

/** True when a database is configured at all — lets read-only pages degrade gracefully. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
