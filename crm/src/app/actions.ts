"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser, requireTasksAccess } from "@/lib/auth/server";
import {
  activityTypeFromEventType,
  dispositions,
  timelineEventTypes,
} from "@/lib/crm/domain";
import {
  applyTerminalDisposition,
  insertActivityAndFollowUp,
} from "@/lib/crm/mutations";
import { requireTaskMutationAccess } from "@/lib/crm/task-access";

const uuid = z.string().uuid();

const activityInput = z.object({
  prospectId: uuid,
  eventType: z.enum(timelineEventTypes),
  body: z.string().trim().min(1).max(10_000),
  disposition: z.enum(dispositions).optional(),
  followUpTitle: z.string().trim().max(500).optional(),
  followUpDueAt: z.string().optional(),
});

export async function logActivityAction(formData: FormData) {
  const user = await requireProspectingUser();
  const parsed = activityInput.parse({
    prospectId: formData.get("prospectId"),
    eventType: formData.get("eventType"),
    body: formData.get("body"),
    disposition: formData.get("disposition") || undefined,
    followUpTitle: formData.get("followUpTitle") || undefined,
    followUpDueAt: formData.get("followUpDueAt") || undefined,
  });
  const dueAt = parsed.followUpDueAt
    ? z.coerce.date().parse(parsed.followUpDueAt)
    : undefined;
  if (Boolean(parsed.followUpTitle) !== Boolean(dueAt)) {
    throw new Error("A follow-up needs both an action and a due date.");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await insertActivityAndFollowUp(client, {
      prospectId: parsed.prospectId,
      type: activityTypeFromEventType(parsed.eventType),
      body: parsed.body,
      disposition: parsed.disposition,
      actorType: "human",
      actorUserId: user.id,
      actorName: user.name,
      metadata: { eventType: parsed.eventType },
      followUp:
        parsed.followUpTitle && dueAt
          ? { title: parsed.followUpTitle, dueAt, assignedUserId: user.id }
          : undefined,
    });

    await applyTerminalDisposition(client, parsed.prospectId, parsed.disposition);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  revalidatePath(`/prospecting/${parsed.prospectId}`);
  revalidatePath("/prospecting");
  revalidatePath("/tasks");
}

export async function updateTaskStatusAction(formData: FormData) {
  const access = await requireTasksAccess();
  const taskId = uuid.parse(formData.get("taskId"));
  const status = z.enum(["open", "complete", "canceled"]).parse(formData.get("status"));
  const existing = await getPool().query<{
    assigned_user_id: string | null;
    prospect_id: string | null;
    booking_id: string | null;
    organization_id: string | null;
  }>(
    `SELECT assigned_user_id::text, prospect_id::text, booking_id::text,
            organization_id::text
     FROM crm.tasks
     WHERE id = $1::uuid`,
    [taskId],
  );
  const task = existing.rows[0];
  if (!task) throw new Error("Task not found.");
  await requireTaskMutationAccess(access, task);
  await getPool().query(
    `
      UPDATE crm.tasks
      SET status = $2::crm.task_status,
          completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE NULL END,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [taskId, status],
  );
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function signOutAction() {
  const { auth } = await import("@/lib/auth/neon");
  await auth.signOut();
  redirect("/auth/sign-in");
}
