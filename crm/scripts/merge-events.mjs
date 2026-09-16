import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function eventMatchKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/^\s*20\d{2}\s+/, "")
    .replace(/\s*[-–—]\s*(renewal|new|timing lead)\s*$/i, "")
    .replace(/&/g, " and ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericEventName(name) {
  const key = eventMatchKey(name);
  return key === "private race" || key.startsWith("private races");
}

function score(event) {
  return (
    (event.owner_id ? 8 : 0) +
    (event.catalog_race_listing_id ? 4 : 0) +
    event.occurrence_count +
    (event.website ? 1 : 0)
  );
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("BEGIN");

try {
  const events = await client.query(`
    SELECT event.id::text, event.name,
      event.default_owner_organization_id::text AS owner_id,
      event.catalog_race_listing_id, event.website, event.notes,
      COUNT(occurrence.id)::int AS occurrence_count
    FROM crm.events event
    LEFT JOIN crm.event_occurrences occurrence ON occurrence.event_id = event.id
    WHERE event.archived_at IS NULL
    GROUP BY event.id
  `);

  const groups = new Map();
  for (const event of events.rows) {
    if (isGenericEventName(event.name)) continue;
    const key = eventMatchKey(event.name);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const merged = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((left, right) => score(right) - score(left));
    const survivor = ranked[0];
    const duplicates = ranked.slice(1);
    for (const duplicate of duplicates) {
      await client.query(
        `UPDATE crm.event_occurrences SET event_id = $1::uuid, updated_at = now()
         WHERE event_id = $2::uuid`,
        [survivor.id, duplicate.id],
      );
      await client.query(
        `UPDATE crm.prospects SET event_id = $1::uuid, updated_at = now()
         WHERE event_id = $2::uuid`,
        [survivor.id, duplicate.id],
      );
      await client.query(
        `UPDATE crm.events SET
           default_owner_organization_id =
             COALESCE(default_owner_organization_id, $2::uuid),
           catalog_race_listing_id =
             COALESCE(catalog_race_listing_id, $3),
           website = COALESCE(website, $4),
           notes = COALESCE(notes, $5),
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          survivor.id,
          duplicate.owner_id,
          duplicate.catalog_race_listing_id,
          duplicate.website,
          duplicate.notes,
        ],
      );
      await client.query(
        `UPDATE crm.external_records SET local_id = $1::uuid, updated_at = now()
         WHERE local_id = $2::uuid`,
        [survivor.id, duplicate.id],
      );
      await client.query(`DELETE FROM crm.events WHERE id = $1::uuid`, [
        duplicate.id,
      ]);
    }
    merged.push({
      key,
      survivor: survivor.name,
      survivorId: survivor.id,
      absorbed: duplicates.map((event) => event.name),
    });
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ mergedCount: merged.length, merged }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
