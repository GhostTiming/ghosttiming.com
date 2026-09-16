import type { PoolClient } from "pg";
import {
  activityTypeFromEventType,
  eventTypeLabel,
  type TimelineEventType,
} from "./domain";

type RelatedRecord =
  | { prospectId: string; bookingId?: never; organizationId?: never }
  | { bookingId: string; prospectId?: never; organizationId?: never }
  | { organizationId: string; prospectId?: never; bookingId?: never };

export async function appendAuditActivity(
  client: PoolClient,
  record: RelatedRecord,
  actor: { id: string; name: string },
  body: string,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    `
      INSERT INTO crm.activities
        (prospect_id, booking_id, organization_id, type, body, actor_type,
         actor_user_id, actor_name, metadata)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'note', $4, 'human',
        $5::uuid, $6, $7::jsonb)
    `,
    [
      record.prospectId ?? null,
      record.bookingId ?? null,
      record.organizationId ?? null,
      body,
      actor.id,
      actor.name,
      JSON.stringify(metadata),
    ],
  );
}

export async function upsertTaskTimelineActivity(
  client: PoolClient,
  input: {
    taskId: string;
    prospectId?: string;
    bookingId?: string;
    organizationId?: string;
    eventType: TimelineEventType;
    description: string;
    actor: { id: string; name: string };
    legacyTitle?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const type = activityTypeFromEventType(input.eventType);
  const body = input.description.trim() || eventTypeLabel(input.eventType);
  const metadata = JSON.stringify({
    taskId: input.taskId,
    eventType: input.eventType,
    ...input.metadata,
  });
  const updated = await client.query<{ id: string }>(
    `
      UPDATE crm.activities
      SET type = $2::crm.activity_type,
          body = $3,
          metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      WHERE id = (
        SELECT id FROM crm.activities
        WHERE metadata->>'taskId' = $1
        ORDER BY occurred_at ASC, created_at ASC
        LIMIT 1
      )
      RETURNING id::text
    `,
    [input.taskId, type, body, metadata],
  );
  if (updated.rows[0]) return updated.rows[0].id;

  if (input.legacyTitle) {
    const claimed = await client.query<{ id: string }>(
      `
        UPDATE crm.activities
        SET type = $1::crm.activity_type,
            body = $2,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = (
          SELECT id FROM crm.activities
          WHERE metadata->>'taskId' IS NULL
            AND type = 'note'
            AND prospect_id IS NOT DISTINCT FROM $4::uuid
            AND booking_id IS NOT DISTINCT FROM $5::uuid
            AND organization_id IS NOT DISTINCT FROM $6::uuid
            AND (
              body = 'Task created: ' || $7
              OR body = 'Task updated: ' || $7
            )
          ORDER BY occurred_at ASC, created_at ASC
          LIMIT 1
        )
        RETURNING id::text
      `,
      [
        type,
        body,
        metadata,
        input.prospectId ?? null,
        input.bookingId ?? null,
        input.organizationId ?? null,
        input.legacyTitle,
      ],
    );
    if (claimed.rows[0]) return claimed.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO crm.activities
        (prospect_id, booking_id, organization_id, type, body, actor_type,
         actor_user_id, actor_name, metadata)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::crm.activity_type, $5, 'human',
        $6::uuid, $7, $8::jsonb)
      RETURNING id::text
    `,
    [
      input.prospectId ?? null,
      input.bookingId ?? null,
      input.organizationId ?? null,
      type,
      body,
      input.actor.id,
      input.actor.name,
      metadata,
    ],
  );
  return inserted.rows[0].id;
}

