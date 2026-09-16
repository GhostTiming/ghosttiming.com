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
import { Client } from "pg";

import { syncRaceRosterEventsToCatalog } from "../src/lib/race-roster/sync.ts";

const eventIds = (process.env.RACE_ROSTER_EVENT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const dryRun = ["1", "true", "yes"].includes(
  (process.env.RACE_ROSTER_DRY_RUN || "").toLowerCase(),
);

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
    console.error(
      "Save this refresh token as RACE_ROSTER_REFRESH_TOKEN for the next sync (expires in ~25h):",
    );
    console.error(refreshToken);
  }
} catch (error) {
  if (!dryRun) await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
