"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireAdmin } from "@/lib/auth/server";
import {
  activityTypeFromEventType,
  eventTypeLabel,
  timelineEventTypes,
} from "@/lib/crm/domain";

const uuid = z.string().uuid();

function refreshActivityPaths(record: {
  prospect_id: string | null;
  booking_id: string | null;
  organization_id: string | null;
}) {
  if (record.prospect_id) revalidatePath(`/prospecting/${record.prospect_id}`);
  if (record.booking_id) revalidatePath(`/bookings/${record.booking_id}`);
  if (record.organization_id) {
    revalidatePath(`/organizations/${record.organization_id}`);
  }
  revalidatePath("/prospecting");
  revalidatePath("/tasks");
}

export async function updateActivityAction(formData: FormData) {
  const user = await requireAdmin();
  const input = z.object({
    activityId: uuid,
    eventType: z.enum(timelineEventTypes).optional(),
    body: z.string().trim().min(1).max(10_000),
    occurredAt: z.string().min(1),
  }).parse({
    activityId: formData.get("activityId"),
    eventType: formData.get("eventType") || undefined,
    body: formData.get("body"),
    occurredAt: formData.get("occurredAt"),
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{
      type: string;
      metadata: { taskId?: string; eventType?: string } | null;
      prospect_id: string | null;
      booking_id: string | null;
      organization_id: string | null;
    }>(
      `SELECT type::text, metadata, prospect_id::text, booking_id::text,
              organization_id::text
       FROM crm.activities WHERE id = $1::uuid`,
      [input.activityId],
    );
    const activity = existing.rows[0];
    if (!activity) throw new Error("Activity not found.");

    const keepStageChange = activity.type === "stage_change";
    if (!keepStageChange && !input.eventType) {
      throw new Error("Event type is required.");
    }
    const eventType = keepStageChange ? undefined : input.eventType;
    const type = eventType
      ? activityTypeFromEventType(eventType)
      : "stage_change";
    const metadataPatch = eventType
      ? { eventType, updatedBy: user.id }
      : { updatedBy: user.id };

    await client.query(
      `
        UPDATE crm.activities
        SET type = $2::crm.activity_type,
            body = $3,
            occurred_at = $4::timestamp AT TIME ZONE 'America/New_York',
            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
        WHERE id = $1::uuid
      `,
      [
        input.activityId,
        type,
        input.body,
        input.occurredAt,
        JSON.stringify(metadataPatch),
      ],
    );

    const taskId = activity.metadata?.taskId;
    if (taskId && eventType) {
      await client.query(
        `
          UPDATE crm.tasks
          SET title = $2, notes = $3, updated_at = now()
          WHERE id = $1::uuid
        `,
        [taskId, eventType, input.body === eventTypeLabel(eventType) ? null : input.body],
      );
    }
    await client.query("COMMIT");
    refreshActivityPaths(activity);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteActivityAction(formData: FormData) {
  await requireAdmin();
  const activityId = uuid.parse(formData.get("activityId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE crm.tasks SET source_activity_id = NULL, updated_at = now()
       WHERE source_activity_id = $1::uuid`,
      [activityId],
    );
    const removed = await client.query<{
      prospect_id: string | null;
      booking_id: string | null;
      organization_id: string | null;
    }>(
      `DELETE FROM crm.activities
       WHERE id = $1::uuid
       RETURNING prospect_id::text, booking_id::text, organization_id::text`,
      [activityId],
    );
    const record = removed.rows[0];
    if (!record) throw new Error("Activity not found.");
    await client.query("COMMIT");
    refreshActivityPaths(record);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
