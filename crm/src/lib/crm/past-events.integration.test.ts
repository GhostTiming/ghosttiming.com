import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filePastProspects } from "./past-events";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
let pool: Pool;

integration("past event filing", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("moves a live past-dated lead to Past events and cancels open tasks", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Past Event Test', $2, 'admin')
         RETURNING id::text`,
        [`past-${suffix}`, `past-${suffix}@example.com`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual')
         RETURNING id::text`,
        [`Past Race ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, race_date, timezone)
         VALUES ($1::uuid, 2026, now() - interval '40 days', 'America/New_York')
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
      await client.query(
        `INSERT INTO crm.tasks
           (prospect_id, assigned_user_id, title, due_at, status)
         VALUES ($1::uuid, $2::uuid, 'email_out', now() + interval '3 days', 'open')`,
        [prospect.rows[0].id, user.rows[0].id],
      );

      const result = await filePastProspects(client, [prospect.rows[0].id]);
      expect(result.filed).toBe(1);
      expect(result.canceledTasks).toBe(1);

      const state = await client.query<{
        stage_key: string;
        closed_at: Date | null;
        task_status: string;
      }>(
        `SELECT stage.key AS stage_key, prospect.closed_at, task.status::text AS task_status
         FROM crm.prospects prospect
         JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
         JOIN crm.tasks task ON task.prospect_id = prospect.id
         WHERE prospect.id = $1::uuid`,
        [prospect.rows[0].id],
      );
      expect(state.rows[0].stage_key).toBe("past_event");
      expect(state.rows[0].closed_at).toBeTruthy();
      expect(state.rows[0].task_status).toBe("canceled");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaves closed-lost and future races in place", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string }>(
        `INSERT INTO crm.users (auth_provider_id, name, email, role)
         VALUES ($1, 'Keep Stage Test', $2, 'admin')
         RETURNING id::text`,
        [`keep-${suffix}`, `keep-${suffix}@example.com`],
      );
      const event = await client.query<{ id: string }>(
        `INSERT INTO crm.events (name, source_type)
         VALUES ($1, 'manual')
         RETURNING id::text`,
        [`Future Race ${suffix}`],
      );
      const occurrence = await client.query<{ id: string }>(
        `INSERT INTO crm.event_occurrences
           (event_id, occurrence_year, race_date, timezone)
         VALUES ($1::uuid, 2027, now() + interval '40 days', 'America/New_York')
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
      await filePastProspects(client, [prospect.rows[0].id]);
      const state = await client.query<{ stage_key: string }>(
        `SELECT stage.key AS stage_key
         FROM crm.prospects prospect
         JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
         WHERE prospect.id = $1::uuid`,
        [prospect.rows[0].id],
      );
      expect(state.rows[0].stage_key).toBe("cold");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
