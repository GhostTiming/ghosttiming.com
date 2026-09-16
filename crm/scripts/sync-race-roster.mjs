#!/usr/bin/env node
/**
 * Sync Race Roster timer events into catalog.race_listings / editions / offerings.
 *
 * Required env:
 *   DATABASE_URL
 *   RACE_ROSTER_CLIENT_ID
 *   RACE_ROSTER_CLIENT_SECRET
 *   RACE_ROSTER_USERNAME + RACE_ROSTER_PASSWORD
 *     OR RACE_ROSTER_REFRESH_TOKEN
 *
 * Optional:
 *   RACE_ROSTER_CLIENT_NAME
 *   RACE_ROSTER_EVENT_IDS=id1,id2
 *   RACE_ROSTER_DRY_RUN=1
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Client } from "pg";

import { syncRaceRosterEventsToCatalog } from "../src/lib/race-roster/sync.ts";

const eventIds = (process.env.RACE_ROSTER_EVENT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const dryRun = ["1", "true", "yes"].includes(
  (process.env.RACE_ROSTER_DRY_RUN || "").toLowerCase(),
);

function persistRefreshToken(token) {
  const envPath = new URL("../.env.local", import.meta.url);
  const path = envPath.pathname;
  if (!existsSync(path)) {
    console.error("Received a refresh token but .env.local is missing; not writing it.");
    return;
  }
  const current = readFileSync(path, "utf8");
  const line = `RACE_ROSTER_REFRESH_TOKEN=${token}`;
  const next = current.includes("RACE_ROSTER_REFRESH_TOKEN=")
    ? current.replace(/^RACE_ROSTER_REFRESH_TOKEN=.*$/m, line)
    : `${current.trimEnd()}\n${line}\n`;
  writeFileSync(path, next, { mode: 0o600 });
  console.error("Saved RACE_ROSTER_REFRESH_TOKEN to .env.local (not printed).");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  if (!dryRun) await client.query("BEGIN");
  const result = await syncRaceRosterEventsToCatalog(client, {
    eventIds: eventIds.length ? eventIds : undefined,
    dryRun,
  });
  if (!dryRun) await client.query("COMMIT");
  const { refreshToken, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  if (refreshToken && !process.env.RACE_ROSTER_REFRESH_TOKEN) {
    persistRefreshToken(refreshToken);
  }
} catch (error) {
  if (!dryRun) await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
