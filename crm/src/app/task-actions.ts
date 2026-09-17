"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireTasksAccess } from "@/lib/auth/server";
import { appendAuditActivity, upsertTaskTimelineActivity } from "@/lib/crm/audit";
import { timelineEventTypes } from "@/lib/crm/domain";
import { markTaskCalendarNeedsSync } from "@/lib/crm/task-calendar-sync";
import {
  requireTaskMutationAccess,
  requireTaskRecordAccess,
} from "@/lib/crm/task-access";

const uuid = z.string().uuid();

function refreshRelated(input: {
  prospectId?: string;
  bookingId?: string;
  organizationId?: string;
}) {
  if (input.prospectId) revalidatePath(`/prospecting/${input.prospectId}`);
  if (input.bookingId) revalidatePath(`/bookings/${input.bookingId}`);
  if (input.organizationId) revalidatePath(`/organizations/${input.organizationId}`);
  revalidatePath("/prospecting");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function saveTaskAction(formData: FormData) {
  const access = await requireTasksAccess();
  const user = access.user;
  const input = z.object({
    taskId: uuid.optional(),
    prospectId: uuid.optional(),
    bookingId: uuid.optional(),
    organizationId: uuid.optional(),
    assignedUserId: uuid.optional(),
    eventType: z.enum(timelineEventTypes),
    description: z.string().trim().max(10_000).optional(),
    dueAt: z.string().min(1),
    status: z.enum(["open", "complete", "canceled"]),
  }).refine(
    (value) => [value.prospectId, value.bookingId, value.organizationId]
      .filter(Boolean).length === 1,
    { message: "A task must belong to exactly one CRM record." },
  ).parse({
    taskId: formData.get("taskId") || undefined,
    prospectId: formData.get("prospectId") || undefined,
    bookingId: formData.get("bookingId") || undefined,
    organizationId: formData.get("organizationId") || undefined,
    assignedUserId: formData.get("assignedUserId") || undefined,
    eventType: formData.get("eventType"),
    description: formData.get("description") || undefined,
    dueAt: formData.get("dueAt"),
    status: formData.get("status") || "open",
  });
  await requireTaskRecordAccess(access, input);
  const notes = input.description || null;
  const related = {
    prospectId: input.prospectId,
    bookingId: input.bookingId,
    organizationId: input.organizationId,
  };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let taskId = input.taskId;
    let legacyTitle: string | undefined;
    if (!taskId) {
      const duplicate = await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM crm.tasks
          WHERE prospect_id IS NOT DISTINCT FROM $1::uuid
            AND booking_id IS NOT DISTINCT FROM $2::uuid
            AND organization_id IS NOT DISTINCT FROM $3::uuid
            AND title = $4
            AND date_trunc('minute', due_at) =
              date_trunc('minute', $5::timestamp AT TIME ZONE 'America/New_York')
            AND created_at > now() - interval '15 seconds'
          ORDER BY created_at
          LIMIT 1
        `,
        [
          input.prospectId ?? null,
          input.bookingId ?? null,
          input.organizationId ?? null,
          input.eventType,
          input.dueAt,
        ],
      );
      taskId = duplicate.rows[0]?.id;
    }
    if (taskId) {
      const existing = await client.query<{
        title: string;
        assigned_user_id: string | null;
        prospect_id: string | null;
        booking_id: string | null;
        organization_id: string | null;
      }>(
        `SELECT title, assigned_user_id::text, prospect_id::text, booking_id::text,
                organization_id::text
         FROM crm.tasks WHERE id = $1::uuid`,
        [taskId],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("Task not found.");
      await requireTaskMutationAccess(access, row);
      legacyTitle = row.title;
      const changed = await client.query(
        `UPDATE crm.tasks SET assigned_user_id = $5::uuid, title = $6,
           notes = $7, due_at = $8::timestamp AT TIME ZONE 'America/New_York',
           status = $9::crm.task_status,
           completed_at = CASE WHEN $9 = 'complete' THEN
             COALESCE(completed_at, now()) ELSE NULL END,
           updated_at = now()
         WHERE id = $1::uuid
           AND prospect_id IS NOT DISTINCT FROM $2::uuid
           AND booking_id IS NOT DISTINCT FROM $3::uuid
           AND organization_id IS NOT DISTINCT FROM $4::uuid
         RETURNING id`,
        [taskId, input.prospectId ?? null, input.bookingId ?? null,
          input.organizationId ?? null, input.assignedUserId ?? user.id,
          input.eventType, notes, input.dueAt, input.status],
      );
      if (!changed.rowCount) throw new Error("Task not found.");
      await markTaskCalendarNeedsSync(client, taskId);
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO crm.tasks
          (prospect_id, booking_id, organization_id, assigned_user_id,
           title, notes, due_at, status, completed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
           $7::timestamp AT TIME ZONE 'America/New_York',
           $8::crm.task_status,
           CASE WHEN $8 = 'complete' THEN now() ELSE NULL END)
         RETURNING id::text`,
        [input.prospectId ?? null, input.bookingId ?? null,
          input.organizationId ?? null, input.assignedUserId ?? user.id,
          input.eventType, notes, input.dueAt, input.status],
      );
      taskId = created.rows[0].id;
    }
    await upsertTaskTimelineActivity(client, {
      ...related,
      taskId,
      eventType: input.eventType,
      description: notes ?? "",
      actor: user,
      legacyTitle,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshRelated(related);
}

export async function removeTaskAction(formData: FormData) {
  const access = await requireTasksAccess();
  const taskId = uuid.parse(formData.get("taskId"));
  const client = await getPool().connect();
  let related: {
    prospect_id: string | null;
    booking_id: string | null;
    organization_id: string | null;
    title: string;
  } | undefined;
  try {
    await client.query("BEGIN");
    const existing = await client.query<{
      prospect_id: string | null;
      booking_id: string | null;
      organization_id: string | null;
      title: string;
      assigned_user_id: string | null;
    }>(
      `SELECT prospect_id::text, booking_id::text, organization_id::text, title,
              assigned_user_id::text
       FROM crm.tasks
       WHERE id = $1::uuid`,
      [taskId],
    );
    const row = existing.rows[0];
    if (!row) notFound();
    await requireTaskMutationAccess(access, row);
    const removed = await client.query<{
      prospect_id: string | null;
      booking_id: string | null;
      organization_id: string | null;
      title: string;
    }>(
      `DELETE FROM crm.tasks
       WHERE id = $1::uuid
       RETURNING prospect_id::text, booking_id::text, organization_id::text, title`,
      [taskId],
    );
    related = removed.rows[0];
    if (related) {
      const body = `Task removed: ${related.title}`;
      if (related.prospect_id) {
        await appendAuditActivity(client, { prospectId: related.prospect_id }, access.user, body);
      } else if (related.booking_id) {
        await appendAuditActivity(client, { bookingId: related.booking_id }, access.user, body);
      } else if (related.organization_id) {
        await appendAuditActivity(
          client,
          { organizationId: related.organization_id },
          access.user,
          body,
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshRelated({
    prospectId: related?.prospect_id ?? undefined,
    bookingId: related?.booking_id ?? undefined,
    organizationId: related?.organization_id ?? undefined,
  });
}
