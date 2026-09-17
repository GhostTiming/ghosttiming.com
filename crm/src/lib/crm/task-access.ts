import { notFound } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireBookingOperator, requireTasksAccess } from "@/lib/auth/server";
import type { AccessContext } from "@/lib/auth/access";

export async function requireTaskRecordAccess(
  access: AccessContext,
  related: {
    prospectId?: string | null;
    bookingId?: string | null;
    organizationId?: string | null;
  },
) {
  if (related.bookingId) {
    await requireBookingOperator(related.bookingId);
    return;
  }
  if (related.organizationId) {
    if (!access.canAccessOrganization(related.organizationId)) notFound();
    return;
  }
  if (related.prospectId) {
    if (!access.canAccessProspecting) notFound();
    return;
  }
  notFound();
}

export async function requireTaskMutationAccess(
  access: AccessContext,
  task: {
    assigned_user_id: string | null;
    prospect_id: string | null;
    booking_id: string | null;
    organization_id: string | null;
  },
) {
  if (task.assigned_user_id === access.user.id || access.isSuperAdmin) {
    return;
  }
  await requireTaskRecordAccess(access, {
    prospectId: task.prospect_id,
    bookingId: task.booking_id,
    organizationId: task.organization_id,
  });
}

export async function requireTaskOperator(taskId: string) {
  const access = await requireTasksAccess();
  const parsedTaskId = z.string().uuid().parse(taskId);
  const result = await getPool().query<{
    id: string;
    assigned_user_id: string | null;
    prospect_id: string | null;
    booking_id: string | null;
    organization_id: string | null;
  }>(
    `
      SELECT id::text, assigned_user_id::text, prospect_id::text,
             booking_id::text, organization_id::text
      FROM crm.tasks
      WHERE id = $1::uuid
    `,
    [parsedTaskId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Task not found.");
  await requireTaskMutationAccess(access, row);
  return { access, user: access.user, task: row };
}
