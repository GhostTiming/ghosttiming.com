import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  crmPool?: Pool;
};

function attachPoolForVercel(pool: Pool) {
  if (process.env.VERCEL !== "1") return;
  void import("@vercel/functions")
    .then(({ attachDatabasePool }) => {
      attachDatabasePool(pool);
    })
    .catch(() => {
      // Fluid Compute registration is optional if the helper is unavailable.
    });
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  attachPoolForVercel(pool);
  return pool;
}

export function getPool() {
  globalForDb.crmPool ??= createPool();
  return globalForDb.crmPool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export type Database = ReturnType<typeof getDb>;
