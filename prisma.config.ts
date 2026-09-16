import path from "node:path";

import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved the connection URL out of schema.prisma. Migrations read it
 * from here; the runtime client gets it through the pg driver adapter in
 * lib/db/client.ts. Both ultimately read the same DATABASE_URL.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
