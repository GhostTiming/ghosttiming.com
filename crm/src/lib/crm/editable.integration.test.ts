import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAuditActivity } from "./audit";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
let pool: Pool;

integration("editable CRM records", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("stores catalog-backed event corrections only in the private CRM schema", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const source = await client.query<{
        event_id: string;
        catalog_name: string;
      }>(
        `SELECT prospect.event_id::text, listing.name AS catalog_name
         FROM crm.prospects prospect
         JOIN catalog.race_listings listing
           ON listing.id = prospect.race_listing_id
         WHERE prospect.event_id IS NOT NULL
         LIMIT 1`,
      );
      expect(source.rows[0]).toBeTruthy();
      const override = `Private correction ${randomUUID()}`;
      await client.query(
        `UPDATE crm.events SET name = $2 WHERE id = $1::uuid`,
        [source.rows[0].event_id, override],
      );
      const result = await client.query<{
        private_name: string;
        catalog_name: string;
      }>(
        `SELECT event.name AS private_name, listing.name AS catalog_name
         FROM crm.events event
         JOIN catalog.race_listings listing
           ON listing.id = event.catalog_race_listing_id
         WHERE event.id = $1::uuid`,
        [source.rows[0].event_id],
      );
      expect(result.rows[0].private_name).toBe(override);
      expect(result.rows[0].catalog_name).toBe(source.rows[0].catalog_name);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("supports a manual lead contact, archive lifecycle, and append-only audit", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Editable Test', $2, 'admin') RETURNING id::text`,
        [`editable-${suffix}`, `editable-${suffix}@example.com`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual') RETURNING id::text`,
        [`Manual ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences (event_id, occurrence_year, timezone)
         VALUES ($1::uuid, 2030, 'America/New_York') RETURNING id::text`,
        [event.rows[0].id],
      );
      const prospect = await client.query<{ id: string }>(
        `INSERT INTO crm.prospects
          (event_id, occurrence_id, assigned_user_id, stage_id)
         SELECT $1::uuid, $2::uuid, $3::uuid, id
         FROM crm.pipeline_stages
         WHERE pipeline = 'prospect' AND key = 'cold'
         RETURNING id::text`,
        [event.rows[0].id, occurrence.rows[0].id, user.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.contact_methods
          (prospect_id, type, raw_value, normalized_value, source)
         VALUES ($1::uuid, 'email', $2, lower($2), 'manual')`,
        [prospect.rows[0].id, `lead-${suffix}@example.com`],
      );
      await appendAuditActivity(
        client,
        { prospectId: prospect.rows[0].id },
        { id: user.rows[0].id, name: "Editable Test" },
        "Private event details updated",
      );
      await client.query(
        `UPDATE crm.prospects SET archived_at = now(),
          archived_by_user_id = $2::uuid WHERE id = $1::uuid`,
        [prospect.rows[0].id, user.rows[0].id],
      );
      const state = await client.query<{
        listing_id: string | null;
        contact_count: number;
        activity_count: number;
        is_archived: boolean;
      }>(
        `SELECT prospect.race_listing_id AS listing_id,
          (SELECT COUNT(*) FROM crm.contact_methods
            WHERE prospect_id = prospect.id)::integer AS contact_count,
          (SELECT COUNT(*) FROM crm.activities
            WHERE prospect_id = prospect.id)::integer AS activity_count,
          prospect.archived_at IS NOT NULL AS is_archived
         FROM crm.prospects prospect WHERE prospect.id = $1::uuid`,
        [prospect.rows[0].id],
      );
      expect(state.rows[0]).toEqual({
        listing_id: null,
        contact_count: 1,
        activity_count: 1,
        is_archived: true,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

