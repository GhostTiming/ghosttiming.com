import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertActivityAndFollowUp } from "./mutations";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
let pool: Pool;

integration("CRM activity transaction and read model", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a linked follow-up and derives touch/next-step state", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suffix = randomUUID();
      const user = await client.query<{ id: string }>(
        `
          INSERT INTO crm.users (auth_provider_id, name, email, role)
          VALUES ($1, 'Integration Seth', $2, 'prospecting_user')
          RETURNING id::text
        `,
        [`test-${suffix}`, `seth-${suffix}@example.com`],
      );
      const prospect = await client.query<{ id: string }>(
        `
          INSERT INTO crm.prospects
            (race_listing_id, assigned_user_id, stage_id)
          SELECT rl.id, $1::uuid, stage.id
          FROM catalog.race_listings rl
          CROSS JOIN LATERAL (
            SELECT id FROM crm.pipeline_stages
            WHERE pipeline = 'prospect' AND key = 'cold'
          ) stage
          WHERE NOT EXISTS (
            SELECT 1 FROM crm.prospects p WHERE p.race_listing_id = rl.id
          )
          LIMIT 1
          RETURNING id::text
        `,
        [user.rows[0].id],
      );
      const dueAt = new Date(Date.now() + 86_400_000);

      const created = await insertActivityAndFollowUp(client, {
        prospectId: prospect.rows[0].id,
        type: "phone_call",
        body: "Spoke with the race director.",
        disposition: "Interested",
        actorType: "human",
        actorUserId: user.rows[0].id,
        actorName: "Integration Seth",
        followUp: {
          title: "Send timing proposal",
          dueAt,
          assignedUserId: user.rows[0].id,
        },
      });

      expect(created.activityId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(created.taskId).toBeTruthy();

      const state = await client.query<{
        touch_count: number;
        next_step: string;
        last_disposition: string;
      }>(
        `
          SELECT touch_count, next_step, last_disposition
          FROM crm.prospect_work_queue
          WHERE prospect_id = $1::uuid
        `,
        [prospect.rows[0].id],
      );
      expect(state.rows[0]).toMatchObject({
        touch_count: 1,
        next_step: "Send timing proposal",
        last_disposition: "Interested",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("makes Seth's committed activity visible to Michelle's connection", async () => {
    const writer = await pool.connect();
    const reader = await pool.connect();
    let prospectId: string | undefined;
    const userIds: string[] = [];
    try {
      const suffix = randomUUID();
      const people = await writer.query<{ id: string; name: string }>(
        `
          INSERT INTO crm.users (auth_provider_id, name, email, role)
          VALUES
            ($1, 'Test Seth', $2, 'prospecting_user'),
            ($3, 'Test Michelle', $4, 'admin')
          RETURNING id::text, name
        `,
        [
          `seth-${suffix}`,
          `seth-${suffix}@example.com`,
          `michelle-${suffix}`,
          `michelle-${suffix}@example.com`,
        ],
      );
      userIds.push(...people.rows.map((person) => person.id));
      const sethId = people.rows.find((person) => person.name === "Test Seth")!.id;
      const prospect = await writer.query<{ id: string }>(
        `
          INSERT INTO crm.prospects
            (race_listing_id, assigned_user_id, stage_id)
          SELECT rl.id, $1::uuid, stage.id
          FROM catalog.race_listings rl
          CROSS JOIN LATERAL (
            SELECT id FROM crm.pipeline_stages
            WHERE pipeline = 'prospect' AND key = 'cold'
          ) stage
          WHERE NOT EXISTS (
            SELECT 1 FROM crm.prospects p WHERE p.race_listing_id = rl.id
          )
          LIMIT 1
          RETURNING id::text
        `,
        [sethId],
      );
      prospectId = prospect.rows[0].id;

      await writer.query("BEGIN");
      await insertActivityAndFollowUp(writer, {
        prospectId,
        type: "phone_call",
        body: "Seth's shared call note",
        actorType: "human",
        actorUserId: sethId,
        actorName: "Test Seth",
        followUp: {
          title: "Shared follow-up",
          dueAt: new Date(Date.now() + 86_400_000),
          assignedUserId: sethId,
        },
      });
      await writer.query("COMMIT");

      const visibleToMichelle = await reader.query<{
        actor_name: string;
        body: string;
        next_step: string;
      }>(
        `
          SELECT a.actor_name, a.body, queue.next_step
          FROM crm.activities a
          JOIN crm.prospect_work_queue queue ON queue.prospect_id = a.prospect_id
          WHERE a.prospect_id = $1::uuid AND a.type = 'phone_call'
        `,
        [prospectId],
      );
      expect(visibleToMichelle.rows[0]).toEqual({
        actor_name: "Test Seth",
        body: "Seth's shared call note",
        next_step: "Shared follow-up",
      });
    } finally {
      await writer.query("ROLLBACK");
      if (prospectId) {
        await writer.query("DELETE FROM crm.prospects WHERE id = $1::uuid", [
          prospectId,
        ]);
      }
      if (userIds.length) {
        await writer.query("DELETE FROM crm.users WHERE id = ANY($1::uuid[])", [
          userIds,
        ]);
      }
      writer.release();
      reader.release();
    }
  });
});
