import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureUpcomingDecisionBookings } from "./upcoming-decision";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
let pool: Pool;

integration("upcoming decision bookings", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("adds an awaiting-decision booking for an upcoming year and skips years already booked", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Upcoming Test', $2, 'admin')
         RETURNING id::text, name`,
        [`upcoming-${suffix}`, `upcoming-${suffix}@example.com`],
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO crm.organizations (name) VALUES ($1) RETURNING id::text`,
        [`Upcoming Org ${suffix}`],
      );
      const listingId = `upcoming-listing-${suffix}`;
      const sourceRaceId = 1_500_000_000 + Math.floor(Math.random() * 500_000_000);
      await client.query(
        `INSERT INTO catalog.race_listings (id, name, timezone, source_race_id, updated_at)
         VALUES ($1, $2, 'America/New_York', $3, now())`,
        [listingId, `Upcoming Classic ${suffix}`, sourceRaceId],
      );
      await client.query(
        `INSERT INTO catalog.race_editions
           (id, race_listing_id, edition_year, starts_at, timezone, is_future, source_race_id)
         VALUES
           ($1, $3, 2026, '2026-04-04 07:00:00', 'America/New_York', false, $4),
           ($2, $3, 2028, '2028-04-08 07:00:00', 'America/New_York', true, $4)`,
        [`upcoming-2026-${suffix}`, `upcoming-2028-${suffix}`, listingId, sourceRaceId],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, catalog_race_listing_id, source_type)
         VALUES ($1, $2, 'manual')
         RETURNING id::text`,
        [`Upcoming Classic ${suffix}`, listingId],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, race_date, timezone)
         VALUES ($1::uuid, 2026, '2026-04-04 11:00:00+00', 'America/New_York')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      const booking = await client.query<{ id: string }>(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id, assigned_user_id)
         SELECT $1::uuid, $2::uuid, stage.id, $3::uuid
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'paid'
         RETURNING id::text`,
        [occurrence.rows[0].id, organization.rows[0].id, user.rows[0].id],
      );

      const opened = await ensureUpcomingDecisionBookings(client, {
        actor: user.rows[0],
        organizationIds: [organization.rows[0].id],
      });
      const mine = opened.created.filter((row) => row.eventName.includes(suffix));
      expect(opened.failed.filter((row) => row.eventName.includes(suffix))).toEqual([]);
      expect(mine).toEqual([
        expect.objectContaining({
          eventName: `Upcoming Classic ${suffix}`,
          year: 2028,
        }),
      ]);

      const stage = await client.query<{ stage_key: string; occurrence_year: number }>(
        `SELECT stage.key AS stage_key, occurrence.occurrence_year
         FROM crm.bookings booking
         JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
         JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
         WHERE booking.id = $1::uuid`,
        [mine[0].bookingId],
      );
      expect(stage.rows[0]).toMatchObject({
        stage_key: "awaiting_decision",
        occurrence_year: 2028,
      });
      expect(booking.rows[0].id).not.toBe(mine[0].bookingId);

      const again = await ensureUpcomingDecisionBookings(client, {
        actor: user.rows[0],
        organizationIds: [organization.rows[0].id],
      });
      expect(again.created.filter((row) => row.eventName.includes(suffix))).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("does not reopen a year that was closed lost", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Upcoming Test', $2, 'admin')
         RETURNING id::text, name`,
        [`upcoming-lost-${suffix}`, `upcoming-lost-${suffix}@example.com`],
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO crm.organizations (name) VALUES ($1) RETURNING id::text`,
        [`Upcoming Lost Org ${suffix}`],
      );
      const listingId = `upcoming-lost-listing-${suffix}`;
      const sourceRaceId = 1_500_000_000 + Math.floor(Math.random() * 500_000_000);
      await client.query(
        `INSERT INTO catalog.race_listings (id, name, timezone, source_race_id, updated_at)
         VALUES ($1, $2, 'America/New_York', $3, now())`,
        [listingId, `Upcoming Lost ${suffix}`, sourceRaceId],
      );
      await client.query(
        `INSERT INTO catalog.race_editions
           (id, race_listing_id, edition_year, starts_at, timezone, is_future, source_race_id)
         VALUES ($1, $2, 2028, '2028-05-01 07:00:00', 'America/New_York', true, $3)`,
        [`upcoming-lost-edition-${suffix}`, listingId, sourceRaceId],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, catalog_race_listing_id, source_type)
         VALUES ($1, $2, 'manual')
         RETURNING id::text`,
        [`Upcoming Lost ${suffix}`, listingId],
      );
      const paidOccurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, race_date, timezone)
         VALUES ($1::uuid, 2026, '2026-05-01 11:00:00+00', 'America/New_York')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id)
         SELECT $1::uuid, $2::uuid, stage.id
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'paid'`,
        [paidOccurrence.rows[0].id, organization.rows[0].id],
      );
      const lostOccurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, race_date, timezone)
         VALUES ($1::uuid, 2028, '2028-05-01 11:00:00+00', 'America/New_York')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id)
         SELECT $1::uuid, $2::uuid, stage.id
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'closed_lost'`,
        [lostOccurrence.rows[0].id, organization.rows[0].id],
      );

      const opened = await ensureUpcomingDecisionBookings(client, {
        actor: user.rows[0],
        organizationIds: [organization.rows[0].id],
      });
      expect(opened.created.filter((row) => row.eventName.includes(suffix))).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
