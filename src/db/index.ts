/**
 * One database handle for the whole process.
 * DATABASE_URL set  -> Postgres (Neon on Vercel, or any Postgres).
 * DATABASE_URL unset -> PGlite, an embedded Postgres kept in ./data/pglite, so `npm run dev`
 *                        and the test-suite need no external service.
 */
import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { databaseUrl, requireDatabaseUrl } from "@/lib/env";

/** Driver-agnostic handle: the same query code runs on postgres-js and PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

let ready: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  if (!ready) ready = open();
  return ready;
}

async function open(): Promise<Db> {
  const url = databaseUrl();
  if (url) {
    // Schema changes are applied by `npm run db:migrate`, not on cold start: several serverless
    // instances starting at once must not race each other on the migration table.
    const sql = postgres(url, { max: 5, prepare: false });
    return drizzlePg(sql, { schema });
  }
  if (requireDatabaseUrl()) {
    throw new Error("DATABASE_URL is not set. The embedded PGlite database is for local development only.");
  }
  return openPglite(path.join(process.cwd(), "data", "pglite"));
}

/** Apply pending migrations to the Postgres in DATABASE_URL. Used by scripts/migrate.ts. */
export async function migrateDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migratePg(drizzlePg(sql, { schema }), { migrationsFolder });
  } finally {
    await sql.end();
  }
}

/** Exposed for tests, which use an in-memory instance (`dataDir` undefined). */
export async function openPglite(dataDir?: string): Promise<Db> {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}
