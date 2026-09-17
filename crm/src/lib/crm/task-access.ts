import { notFound } from "next/navigation";
import { requireBookingOperator } from "@/lib/auth/server";
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
