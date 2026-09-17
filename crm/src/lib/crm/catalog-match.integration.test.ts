import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ARCHIVED_BECAUSE_BOOKING,
  asCatalogQuery,
  archiveProspectsOwnedByLiveBookings,
  autoLinkEventIfUnique,
  clearCatalogMatchDismissed,
  dismissCatalogMatch,
  linkEventToCatalogListing,
  listingOwnedByLiveBooking,
  listingVisibleInLeadPool,
  uniqueCatalogMatch,
  unlinkEventFromCatalogListing,
} from "./catalog-link";
import { eventMatchKey } from "./event-matching";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
let pool: Pool;

integration("booking catalog matching", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("archives the lead on match and returns the listing after Closed Lost", async () => {
    const client = await pool.connect();
      const query = asCatalogQuery((sql, params) => client.query(sql, params));
    try {
      await client.query("BEGIN");
      const listing = await client.query<{ id: string }>(
        `SELECT rl.id
         FROM catalog.race_listings rl
         WHERE rl.next_start_at >= now()
           AND NOT EXISTS (
             SELECT 1 FROM crm.events event
             WHERE event.catalog_race_listing_id = rl.id
           )
           AND EXISTS (
             SELECT 1
             FROM catalog.race_listing_regex_tags tag
             WHERE tag.race_listing_id = rl.id
               AND tag.tag_namespace = 'lead_contact'
               AND tag.tag_key IN ('description_has_email', 'description_has_phone')
               AND tag.tag_value = 'true'
           )
         LIMIT 1`,
      );
      expect(listing.rows[0]).toBeTruthy();
      const listingId = listing.rows[0].id;
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Match Test', $2, 'admin')
         RETURNING id::text, name`,
        [`match-${suffix}`, `match-${suffix}@example.com`],
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO crm.organizations (name)
         VALUES ($1)
         RETURNING id::text`,
        [`Match Org ${suffix}`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual')
         RETURNING id::text`,
        [`Unmatched Booking ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, timezone, city_override, state_override)
         VALUES ($1::uuid, 2031, 'America/New_York', 'Raleigh', 'NC')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id, assigned_user_id)
         SELECT $1::uuid, $2::uuid, stage.id, $3::uuid
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'confirmed'`,
        [occurrence.rows[0].id, organization.rows[0].id, user.rows[0].id],
      );
      const prospect = await client.query<{ id: string }>(
        `INSERT INTO crm.prospects
           (race_listing_id, assigned_user_id, stage_id)
         SELECT $1, $2::uuid, stage.id
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'prospect' AND stage.key = 'cold'
         ON CONFLICT (race_listing_id, (coalesce(race_edition_id, ''))) DO UPDATE
           SET archived_at = NULL,
               archived_by_user_id = NULL,
               updated_at = now()
         RETURNING id::text`,
        [listingId, user.rows[0].id],
      );

      const imported = await client.query<{ id: string }>(
        `INSERT INTO crm.prospects
           (event_id, occurrence_id, assigned_user_id, stage_id)
         SELECT $1::uuid, $2::uuid, $3::uuid, stage.id
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'prospect' AND stage.key = 'cold'
         RETURNING id::text`,
        [event.rows[0].id, occurrence.rows[0].id, user.rows[0].id],
      );

      const beforeMatch = await listingVisibleInLeadPool(query, listingId);
      expect(beforeMatch).toBe(true);

      const linked = await linkEventToCatalogListing(client, {
        eventId: event.rows[0].id,
        listingId,
        occurrenceId: occurrence.rows[0].id,
        actor: user.rows[0],
      });
      expect(linked.archivedCount).toBeGreaterThanOrEqual(2);
      expect(await listingOwnedByLiveBooking(query, listingId)).toBe(true);
      expect(await listingVisibleInLeadPool(query, listingId)).toBe(false);

      const archived = await client.query<{
        archived_at: Date | null;
        body: string | null;
      }>(
        `SELECT prospect.archived_at, activity.body
         FROM crm.prospects prospect
         LEFT JOIN crm.activities activity
           ON activity.prospect_id = prospect.id
          AND activity.body = $2
         WHERE prospect.id = $1::uuid
         ORDER BY activity.created_at DESC
         LIMIT 1`,
        [prospect.rows[0].id, ARCHIVED_BECAUSE_BOOKING],
      );
      expect(archived.rows[0].archived_at).toBeTruthy();
      expect(archived.rows[0].body).toBe(ARCHIVED_BECAUSE_BOOKING);

      const importedArchived = await client.query<{
        archived_at: Date | null;
      }>(
        `SELECT archived_at FROM crm.prospects WHERE id = $1::uuid`,
        [imported.rows[0].id],
      );
      expect(importedArchived.rows[0].archived_at).toBeTruthy();

      await client.query(
        `UPDATE crm.bookings booking
         SET stage_id = stage.id
         FROM crm.pipeline_stages stage
         WHERE booking.occurrence_id = $1::uuid
           AND stage.pipeline = 'booking'
           AND stage.key = 'closed_lost'`,
        [occurrence.rows[0].id],
      );
      expect(await listingOwnedByLiveBooking(query, listingId)).toBe(false);
      expect(await listingVisibleInLeadPool(query, listingId)).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 15_000);

  it("archives leftover imported leads on an already-booked event", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listing = await client.query<{ id: string }>(
        `SELECT rl.id
         FROM catalog.race_listings rl
         WHERE rl.next_start_at >= now()
           AND NOT EXISTS (
             SELECT 1 FROM crm.events event
             WHERE event.catalog_race_listing_id = rl.id
           )
         LIMIT 1`,
      );
      expect(listing.rows[0]).toBeTruthy();
      const listingId = listing.rows[0].id;
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Sweep Test', $2, 'admin')
         RETURNING id::text, name`,
        [`sweep-${suffix}`, `sweep-${suffix}@example.com`],
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO crm.organizations (name)
         VALUES ($1)
         RETURNING id::text`,
        [`Sweep Org ${suffix}`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type, catalog_race_listing_id)
         VALUES ($1, 'manual', $2)
         RETURNING id::text`,
        [`Sweep Booking ${suffix}`, listingId],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, timezone)
         VALUES ($1::uuid, 2031, 'America/New_York')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id, assigned_user_id)
         SELECT $1::uuid, $2::uuid, stage.id, $3::uuid
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'confirmed'`,
        [occurrence.rows[0].id, organization.rows[0].id, user.rows[0].id],
      );
      const leftover = await client.query<{ id: string }>(
        `INSERT INTO crm.prospects
           (event_id, occurrence_id, assigned_user_id, stage_id)
         SELECT $1::uuid, $2::uuid, $3::uuid, stage.id
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'prospect' AND stage.key = 'cold'
         RETURNING id::text`,
        [event.rows[0].id, occurrence.rows[0].id, user.rows[0].id],
      );

      const archived = await archiveProspectsOwnedByLiveBookings(
        client,
        user.rows[0],
      );
      expect(archived).toBeGreaterThanOrEqual(1);
      const leftoverRow = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM crm.prospects WHERE id = $1::uuid`,
        [leftover.rows[0].id],
      );
      expect(leftoverRow.rows[0].archived_at).toBeTruthy();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 15_000);

  it(
    "auto-links a unique unmatched prospect without archiving it",
    async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listings = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM catalog.race_listings`,
      );
      const taken = new Set(
        (
          await client.query<{ id: string }>(
            `SELECT catalog_race_listing_id AS id
             FROM crm.events
             WHERE catalog_race_listing_id IS NOT NULL`,
          )
        ).rows.map((row) => row.id),
      );
      const listingsByKey = new Map<string, { id: string; name: string }[]>();
      for (const listing of listings.rows) {
        const key = eventMatchKey(listing.name);
        if (!key) continue;
        const current = listingsByKey.get(key) ?? [];
        current.push(listing);
        listingsByKey.set(key, current);
      }
      const unique = listings.rows.find((listing) => {
        if (taken.has(listing.id)) return false;
        return uniqueCatalogMatch(listing.name, listingsByKey)?.id === listing.id;
      });
      expect(unique).toBeTruthy();
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Prospect Link', $2, 'admin')
         RETURNING id::text, name`,
        [`plink-${suffix}`, `plink-${suffix}@example.com`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual')
         RETURNING id::text`,
        [unique!.name],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, timezone)
         VALUES ($1::uuid, 2031, 'America/New_York')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      const prospect = await client.query<{ id: string }>(
        `INSERT INTO crm.prospects
           (event_id, occurrence_id, assigned_user_id, stage_id)
         SELECT $1::uuid, $2::uuid, $3::uuid, stage.id
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'prospect' AND stage.key = 'cold'
         RETURNING id::text`,
        [event.rows[0].id, occurrence.rows[0].id, user.rows[0].id],
      );

      const result = await autoLinkEventIfUnique(client, {
        eventId: event.rows[0].id,
        occurrenceId: occurrence.rows[0].id,
        actor: user.rows[0],
        archiveProspects: false,
      });
      const linkedEvent = await client.query<{
        catalog_race_listing_id: string | null;
      }>(
        `SELECT catalog_race_listing_id FROM crm.events WHERE id = $1::uuid`,
        [event.rows[0].id],
      );
      const linkedProspect = await client.query<{
        archived_at: Date | null;
        race_listing_id: string | null;
      }>(
        `SELECT archived_at, race_listing_id
         FROM crm.prospects WHERE id = $1::uuid`,
        [prospect.rows[0].id],
      );

      expect(result.linked).toBeGreaterThanOrEqual(1);
      expect(linkedEvent.rows[0].catalog_race_listing_id).toBe(unique!.id);
      expect(linkedProspect.rows[0].archived_at).toBeNull();
      expect(linkedProspect.rows[0].race_listing_id).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  },
  15_000,
);

  it("lets a dismissed booking undo not-GRV and then link a listing", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listing = await client.query<{ id: string }>(
        `SELECT rl.id
         FROM catalog.race_listings rl
         WHERE NOT EXISTS (
           SELECT 1 FROM crm.events event
           WHERE event.catalog_race_listing_id = rl.id
         )
         LIMIT 1`,
      );
      expect(listing.rows[0]).toBeTruthy();
      const listingId = listing.rows[0].id;
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Undo Match', $2, 'admin')
         RETURNING id::text, name`,
        [`undo-${suffix}`, `undo-${suffix}@example.com`],
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO crm.organizations (name)
         VALUES ($1)
         RETURNING id::text`,
        [`Undo Org ${suffix}`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual')
         RETURNING id::text`,
        [`Undo Match Booking ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, timezone, city_override, state_override)
         VALUES ($1::uuid, 2031, 'America/New_York', 'Raleigh', 'NC')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id, assigned_user_id)
         SELECT $1::uuid, $2::uuid, stage.id, $3::uuid
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'confirmed'`,
        [occurrence.rows[0].id, organization.rows[0].id, user.rows[0].id],
      );

      await dismissCatalogMatch(client, event.rows[0].id);
      const dismissed = await client.query<{
        catalog_race_listing_id: string | null;
        catalog_match_dismissed_at: Date | null;
      }>(
        `SELECT catalog_race_listing_id, catalog_match_dismissed_at
         FROM crm.events WHERE id = $1::uuid`,
        [event.rows[0].id],
      );
      expect(dismissed.rows[0].catalog_race_listing_id).toBeNull();
      expect(dismissed.rows[0].catalog_match_dismissed_at).toBeTruthy();

      await clearCatalogMatchDismissed(client, event.rows[0].id);
      const restored = await client.query<{
        catalog_match_dismissed_at: Date | null;
      }>(
        `SELECT catalog_match_dismissed_at FROM crm.events WHERE id = $1::uuid`,
        [event.rows[0].id],
      );
      expect(restored.rows[0].catalog_match_dismissed_at).toBeNull();

      await linkEventToCatalogListing(client, {
        eventId: event.rows[0].id,
        listingId,
        occurrenceId: occurrence.rows[0].id,
        actor: user.rows[0],
        archiveProspects: false,
      });
      const linked = await client.query<{
        catalog_race_listing_id: string | null;
        catalog_match_dismissed_at: Date | null;
      }>(
        `SELECT catalog_race_listing_id, catalog_match_dismissed_at
         FROM crm.events WHERE id = $1::uuid`,
        [event.rows[0].id],
      );
      expect(linked.rows[0].catalog_race_listing_id).toBe(listingId);
      expect(linked.rows[0].catalog_match_dismissed_at).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 15_000);

  it("uncouples a listing so the booking can rematch", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const listing = await client.query<{ id: string }>(
        `SELECT rl.id
         FROM catalog.race_listings rl
         WHERE NOT EXISTS (
           SELECT 1 FROM crm.events event
           WHERE event.catalog_race_listing_id = rl.id
         )
         LIMIT 1`,
      );
      expect(listing.rows[0]).toBeTruthy();
      const listingId = listing.rows[0].id;
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Uncouple Match', $2, 'admin')
         RETURNING id::text, name`,
        [`uncouple-${suffix}`, `uncouple-${suffix}@example.com`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual')
         RETURNING id::text`,
        [`Uncouple Booking ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, timezone)
         VALUES ($1::uuid, 2031, 'America/New_York')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      await linkEventToCatalogListing(client, {
        eventId: event.rows[0].id,
        listingId,
        occurrenceId: occurrence.rows[0].id,
        actor: user.rows[0],
        archiveProspects: false,
      });
      await unlinkEventFromCatalogListing(client, event.rows[0].id);
      const uncoupled = await client.query<{
        catalog_race_listing_id: string | null;
        catalog_match_dismissed_at: Date | null;
      }>(
        `SELECT catalog_race_listing_id, catalog_match_dismissed_at
         FROM crm.events WHERE id = $1::uuid`,
        [event.rows[0].id],
      );
      expect(uncoupled.rows[0].catalog_race_listing_id).toBeNull();
      expect(uncoupled.rows[0].catalog_match_dismissed_at).toBeNull();
      const edition = await client.query<{ catalog_race_edition_id: string | null }>(
        `SELECT catalog_race_edition_id
         FROM crm.event_occurrences WHERE id = $1::uuid`,
        [occurrence.rows[0].id],
      );
      expect(edition.rows[0].catalog_race_edition_id).toBeNull();
      await linkEventToCatalogListing(client, {
        eventId: event.rows[0].id,
        listingId,
        occurrenceId: occurrence.rows[0].id,
        actor: user.rows[0],
        archiveProspects: false,
      });
      const relinked = await client.query<{ catalog_race_listing_id: string | null }>(
        `SELECT catalog_race_listing_id FROM crm.events WHERE id = $1::uuid`,
        [event.rows[0].id],
      );
      expect(relinked.rows[0].catalog_race_listing_id).toBe(listingId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 15_000);
});
