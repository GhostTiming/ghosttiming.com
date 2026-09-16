import { Client } from "pg";

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

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const events = await client.query(
  `SELECT id::text, name, catalog_race_listing_id
   FROM crm.events WHERE archived_at IS NULL`,
);
const listings = await client.query(`SELECT id, name FROM catalog.race_listings`);

const listingsByKey = new Map();
for (const listing of listings.rows) {
  const key = eventMatchKey(listing.name);
  if (!key) continue;
  const current = listingsByKey.get(key) ?? [];
  current.push(listing);
  listingsByKey.set(key, current);
}

const taken = new Set(
  events.rows.map((event) => event.catalog_race_listing_id).filter(Boolean),
);
let linked = 0;
const samples = [];
for (const event of events.rows) {
  if (event.catalog_race_listing_id || isGenericEventName(event.name)) continue;
  const matches = listingsByKey.get(eventMatchKey(event.name)) ?? [];
  if (matches.length !== 1 || taken.has(matches[0].id)) continue;
  await client.query(
    `UPDATE crm.events
     SET catalog_race_listing_id = $2, updated_at = now()
     WHERE id = $1::uuid AND catalog_race_listing_id IS NULL`,
    [event.id, matches[0].id],
  );
  taken.add(matches[0].id);
  linked += 1;
  if (samples.length < 8) {
    samples.push(`${event.name} -> ${matches[0].name}`);
  }
}

console.log({ linked, considered: events.rows.length, samples });
await client.end();
