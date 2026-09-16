import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const baseUrl = process.env.CRM_TEST_BASE_URL ?? "http://localhost:3001";
const token = process.env.CRM_AI_API_KEY;
assert(token, "CRM_AI_API_KEY is required");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const suffix = randomUUID();
let prospectId;
let userId;

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  assert(
    response.ok,
    `${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
  );
  return body;
}

try {
  const user = await pool.query(
    `
      INSERT INTO crm.users (auth_provider_id, name, email, role)
      VALUES ($1, 'AI API Test Owner', $2, 'prospecting_user')
      RETURNING id::text
    `,
    [`ai-api-test-${suffix}`, `ai-api-test-${suffix}@example.com`],
  );
  userId = user.rows[0].id;
  const prospect = await pool.query(
    `
      INSERT INTO crm.prospects (race_listing_id, assigned_user_id, stage_id)
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
    [userId],
  );
  prospectId = prospect.rows[0].id;

  const activity = await api(`/api/ai/prospects/${prospectId}/activities`, {
    method: "POST",
    body: JSON.stringify({
      type: "email",
      body: "AI API verification outreach",
      disposition: "Interested",
      follow_up: {
        title: "AI API verification follow-up",
        due_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }),
  });
  assert(activity.data.activity_id);
  assert(activity.data.task_id);

  await api(`/api/ai/prospects/${prospectId}`, {
    method: "PATCH",
    body: JSON.stringify({ stage: "interested" }),
  });
  const detail = await api(`/api/ai/prospects/${prospectId}`);
  assert.equal(detail.data.stage, "interested");
  assert.equal(detail.data.touch_count, 1);
  assert.equal(detail.data.next_step, "AI API verification follow-up");
  assert(
    detail.data.activities.some(
      (item) =>
        item.actor_type === "ai" &&
        item.actor_name === (process.env.CRM_AI_ACTOR_NAME || "Claude"),
    ),
  );
  assert(detail.data.tasks.some((item) => item.id === activity.data.task_id));
  console.log(
    JSON.stringify({
      ok: true,
      activity_actor: process.env.CRM_AI_ACTOR_NAME || "Claude",
      touch_count: detail.data.touch_count,
      stage: detail.data.stage,
      follow_up_created: true,
    }),
  );
} finally {
  if (prospectId) {
    await pool.query("DELETE FROM crm.prospects WHERE id = $1::uuid", [prospectId]);
  }
  if (userId) {
    await pool.query("DELETE FROM crm.users WHERE id = $1::uuid", [userId]);
  }
  await pool.end();
}
