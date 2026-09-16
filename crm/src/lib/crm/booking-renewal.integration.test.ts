import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renewBooking } from "./booking-renewal";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
let pool: Pool;

integration("booking renewal copy", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a fresh booking and copies crew without overwriting the original", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string; name: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Renew Test', $2, 'admin')
         RETURNING id::text, name`,
        [`renew-${suffix}`, `renew-${suffix}@example.com`],
      );
      const organization = await client.query<{ id: string }>(
        `INSERT INTO crm.organizations (name)
         VALUES ($1)
         RETURNING id::text`,
        [`Renew Org ${suffix}`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type, notes)
         VALUES ($1, 'manual', 'Keep course notes')
         RETURNING id::text`,
        [`Renewal Classic ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, race_date, timezone, city_override,
            state_override, hardware_event_name, notes)
         VALUES ($1::uuid, 2025, '2025-10-12 11:30:00+00', 'America/New_York',
           'Raleigh', 'NC', 'Classic HW', 'Bring extra mats')
         RETURNING id::text`,
        [event.rows[0].id],
      );
      const booking = await client.query<{ id: string }>(
        `INSERT INTO crm.bookings
           (occurrence_id, direct_client_organization_id, stage_id,
            assigned_user_id, expected_revenue, actual_revenue, amount_paid,
            completed_at, notes)
         SELECT $1::uuid, $2::uuid, stage.id, $3::uuid, 1500, 1600, 1600,
                '2025-10-12 20:00:00+00', 'Client likes early setup'
         FROM crm.pipeline_stages stage
         WHERE stage.pipeline = 'booking' AND stage.key = 'completed'
         RETURNING id::text`,
        [occurrence.rows[0].id, organization.rows[0].id, user.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.crew_assignments (occurrence_id, freeform_name, role)
         VALUES ($1::uuid, 'Seth', 'Lead timer')`,
        [occurrence.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.course_points (occurrence_id, name, notes, sort_order)
         VALUES ($1::uuid, 'Start', 'Power on the left', 0)`,
        [occurrence.rows[0].id],
      );
      await client.query(
        `INSERT INTO crm.occurrence_races
           (occurrence_id, name, start_time, sort_order)
         VALUES ($1::uuid, '5K', '2025-10-12 07:30:00', 0)`,
        [occurrence.rows[0].id],
      );

      const renewed = await renewBooking(client, {
        bookingId: booking.rows[0].id,
        actor: user.rows[0],
        targetYear: 2026,
        refreshFromCatalog: false,
        eventName: `Renewal Classic ${suffix}`,
        timezone: "America/New_York",
        city: "Raleigh",
        state: "NC",
      });

      expect(renewed.bookingId).not.toBe(booking.rows[0].id);
      expect(renewed.eventId).toBe(event.rows[0].id);

      const copied = await client.query<{
        stage_key: string;
        actual_revenue: string | null;
        amount_paid: string;
        completed_at: string | null;
        notes: string | null;
        hardware_event_name: string | null;
        operations_notes: string | null;
        crew_name: string | null;
        point_name: string | null;
        race_start: string | null;
        original_completed: string | null;
      }>(
        `
          SELECT
            stage.key AS stage_key,
            renewed.actual_revenue::text,
            renewed.amount_paid::text,
            renewed.completed_at::text,
            renewed.notes,
            occurrence.hardware_event_name,
            occurrence.notes AS operations_notes,
            crew.freeform_name AS crew_name,
            point.name AS point_name,
            race.start_time::text AS race_start,
            original.completed_at::text AS original_completed
          FROM crm.bookings renewed
          JOIN crm.pipeline_stages stage ON stage.id = renewed.stage_id
          JOIN crm.event_occurrences occurrence
            ON occurrence.id = renewed.occurrence_id
          LEFT JOIN crm.crew_assignments crew
            ON crew.occurrence_id = occurrence.id
          LEFT JOIN crm.course_points point
            ON point.occurrence_id = occurrence.id
          LEFT JOIN crm.occurrence_races race
            ON race.occurrence_id = occurrence.id
          JOIN crm.bookings original ON original.id = $2::uuid
          WHERE renewed.id = $1::uuid
        `,
        [renewed.bookingId, booking.rows[0].id],
      );
      expect(copied.rows[0].stage_key).toBe("confirmed");
      expect(copied.rows[0].actual_revenue).toBeNull();
      expect(Number(copied.rows[0].amount_paid)).toBe(0);
      expect(copied.rows[0].completed_at).toBeNull();
      expect(copied.rows[0].notes).toBe("Client likes early setup");
      expect(copied.rows[0].hardware_event_name).toBe("Classic HW");
      expect(copied.rows[0].operations_notes).toBe("Bring extra mats");
      expect(copied.rows[0].crew_name).toBe("Seth");
      expect(copied.rows[0].point_name).toBe("Start");
      expect(copied.rows[0].race_start).toContain("2026");
      expect(copied.rows[0].original_completed).toBeTruthy();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
