"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db";
import { bookingOrgScopeParam, effectiveAccessUserId } from "@/lib/auth/access";
import {
  requireAdmin,
  requireContactsAccess,
  requireOperationsAccess,
  requireProspectingUser,
  requireTasksAccess,
} from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import {
  isDestructiveBulkUpdate,
  parseBulkIds,
  validateBulkUpdate,
} from "@/lib/crm/bulk-update";
import {
  formatCatalogRefreshSummary,
  refreshBookingsFromCatalog,
} from "@/lib/crm/catalog-refresh";
import { loadContactOrgScope } from "@/lib/crm/contact-queries";
import { personInContactScopeSql } from "@/lib/crm/contacts";
import { changeProspectStage } from "@/lib/crm/mutations";
import { refreshCatalogLinkedViews } from "@/lib/crm/revalidate";

export type BulkActionResult = {
  ok: boolean;
  updated: number;
  skipped: number;
  failed: number;
  message: string;
};

function result(
  updated: number,
  skipped: number,
  failed: number,
  extra?: string,
): BulkActionResult {
  const message = [`${updated} updated`, `${skipped} skipped`, `${failed} failed`]
    .concat(extra ? [extra] : [])
    .join(", ");
  return { ok: failed === 0, updated, skipped, failed, message };
}

function parsePayload(form: {
  ids: unknown;
  field?: string;
  value?: string;
  extra?: Record<string, string | null | undefined>;
}) {
  const ids = parseBulkIds(form.ids);
  if (!ids.success) return ids;
  return {
    success: true as const,
    ids: ids.ids,
    field: String(form.field ?? "").trim(),
    value: String(form.value ?? ""),
    extra: form.extra ?? {},
  };
}

export async function bulkUpdateProspectsAction(input: {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
}): Promise<BulkActionResult> {
  const user = await requireProspectingUser();
  const parsed = parsePayload(input);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const allowed = validateBulkUpdate("prospects", parsed);
  if (!allowed.success) return result(0, 0, parsed.ids.length, allowed.error);
  if (
    isDestructiveBulkUpdate("prospects", parsed.field, parsed.value) &&
    input.extra?.confirmed !== "1"
  ) {
    return result(0, 0, 0, "Confirm this change before applying it.");
  }

  const client = await getPool().connect();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | undefined;
  try {
    await client.query("BEGIN");
    for (const prospectId of parsed.ids) {
      try {
        await client.query("SAVEPOINT bulk_row");
        if (parsed.field === "stage") {
          const changed = await changeProspectStage(
            client,
            prospectId,
            parsed.value,
            {
              actorType: "human",
              actorUserId: user.id,
              actorName: user.name,
            },
            parsed.value === "closed_lost"
              ? {
                  reason: parsed.extra.reason,
                  note: parsed.extra.note,
                  circleBackOn: parsed.extra.circleBackOn,
                }
              : null,
            {
              unqualified:
                parsed.value === "unqualified"
                  ? { reason: parsed.extra.reason, note: parsed.extra.note }
                  : null,
              disqualified:
                parsed.value === "disqualified"
                  ? { reason: parsed.extra.reason, note: parsed.extra.note }
                  : null,
            },
          );
          if (changed) updated += 1;
          else skipped += 1;
        } else {
          const assignee =
            !parsed.value || parsed.value === "__unassigned__" ? null : parsed.value;
          if (assignee) {
            const owner = await client.query(
              `SELECT 1 FROM crm.users WHERE id = $1::uuid AND is_active = true`,
              [assignee],
            );
            if (!owner.rowCount) throw new Error("Choose a valid assignee.");
          }
          const changed = await client.query(
            `UPDATE crm.prospects
             SET assigned_user_id = $2::uuid, updated_at = now()
             WHERE id = $1::uuid
               AND assigned_user_id IS DISTINCT FROM $2::uuid
             RETURNING id`,
            [prospectId, assignee],
          );
          if (changed.rowCount) updated += 1;
          else skipped += 1;
        }
        await client.query("RELEASE SAVEPOINT bulk_row");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT bulk_row");
        failed += 1;
        firstError ??= error instanceof Error ? error.message : "Update failed.";
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/prospecting");
  revalidatePath("/tasks");
  return result(updated, skipped, failed, firstError);
}

export async function bulkUpdateBookingsAction(input: {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
}): Promise<BulkActionResult> {
  const access = await requireOperationsAccess();
  const parsed = parsePayload(input);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const allowed = validateBulkUpdate("bookings", parsed);
  if (!allowed.success) return result(0, 0, parsed.ids.length, allowed.error);
  if (
    isDestructiveBulkUpdate("bookings", parsed.field, parsed.value) &&
    input.extra?.confirmed !== "1"
  ) {
    return result(0, 0, 0, "Confirm this change before applying it.");
  }
  const orgScope = bookingOrgScopeParam(access);
  const client = await getPool().connect();
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | undefined;
  try {
    await client.query("BEGIN");
    const visible = await client.query<{ id: string }>(
      `SELECT booking.id::text
       FROM crm.bookings booking
       WHERE booking.id = ANY($1::uuid[])
         AND ($2::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($2::uuid[]))`,
      [parsed.ids, orgScope],
    );
    const allowedIds = new Set(visible.rows.map((row) => row.id));
    skipped += parsed.ids.filter((id) => !allowedIds.has(id)).length;
    for (const bookingId of parsed.ids) {
      if (!allowedIds.has(bookingId)) continue;
      try {
        await client.query("SAVEPOINT bulk_row");
        if (parsed.field === "stage") {
          if (parsed.value === "ready") {
            const prep = await client.query<{ pending_count: number }>(
              `SELECT COUNT(*)::integer AS pending_count
               FROM crm.booking_prep_items
               WHERE booking_id = $1::uuid AND status = 'pending'`,
              [bookingId],
            );
            if ((prep.rows[0]?.pending_count ?? 0) > 0) {
              throw new Error("Finish prep items before Ready.");
            }
          }
          const changed = await client.query<{ old_name: string; new_name: string }>(
            `
              WITH target AS (
                SELECT id, key, name FROM crm.pipeline_stages
                WHERE pipeline = 'booking' AND key = $2 AND is_active = true
              ),
              previous AS (
                SELECT b.stage_id, stage.name AS old_name
                FROM crm.bookings b
                JOIN crm.pipeline_stages stage ON stage.id = b.stage_id
                WHERE b.id = $1::uuid
              ),
              updated AS (
                UPDATE crm.bookings
                SET stage_id = target.id,
                    completed_at = CASE
                      WHEN target.key IN ('completed', 'paid')
                        THEN COALESCE(bookings.completed_at, now())
                      ELSE bookings.completed_at
                    END,
                    payment_due_at = CASE
                      WHEN target.key IN ('completed', 'paid')
                        THEN COALESCE(bookings.payment_due_at, now() + interval '30 days')
                      ELSE bookings.payment_due_at
                    END,
                    payment_at = CASE
                      WHEN target.key = 'paid' THEN COALESCE(bookings.payment_at, now())
                      ELSE bookings.payment_at
                    END,
                    updated_at = now()
                FROM target, previous
                WHERE bookings.id = $1::uuid AND bookings.stage_id <> target.id
                RETURNING previous.old_name, target.name AS new_name
              )
              SELECT old_name, new_name FROM updated
            `,
            [bookingId, parsed.value],
          );
          if (changed.rows[0]) {
            await appendAuditActivity(
              client,
              { bookingId },
              access.user,
              `Booking changed from ${changed.rows[0].old_name} to ${changed.rows[0].new_name}`,
            );
            updated += 1;
          } else skipped += 1;
        } else if (parsed.field === "timer_location") {
          const changed = await client.query(
            `
              UPDATE crm.event_occurrences occurrence
              SET timer_location = $2::crm.timer_location,
                  updated_at = now()
              FROM crm.bookings booking
              WHERE booking.id = $1::uuid
                AND occurrence.id = booking.occurrence_id
                AND occurrence.timer_location IS DISTINCT FROM $2::crm.timer_location
              RETURNING occurrence.id
            `,
            [bookingId, parsed.value],
          );
          if (changed.rowCount) {
            await appendAuditActivity(
              client,
              { bookingId },
              access.user,
              parsed.value === "remote" ? "Timer set to remote" : "Timer set to on site",
            );
            updated += 1;
          } else skipped += 1;
        } else {
          const assignee =
            !parsed.value || parsed.value === "__unassigned__" ? null : parsed.value;
          if (assignee) {
            const owner = await client.query(
              `SELECT 1 FROM crm.users WHERE id = $1::uuid AND is_active = true`,
              [assignee],
            );
            if (!owner.rowCount) throw new Error("Choose a valid assignee.");
          }
          const changed = await client.query(
            `UPDATE crm.bookings
             SET assigned_user_id = $2::uuid, updated_at = now()
             WHERE id = $1::uuid
               AND assigned_user_id IS DISTINCT FROM $2::uuid
             RETURNING id`,
            [bookingId, assignee],
          );
          if (changed.rowCount) updated += 1;
          else skipped += 1;
        }
        await client.query("RELEASE SAVEPOINT bulk_row");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT bulk_row");
        failed += 1;
        firstError ??= error instanceof Error ? error.message : "Update failed.";
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({});
  return result(updated, skipped, failed, firstError);
}

export async function refreshSelectedBookingsFromCatalogAction(input: {
  ids: string[];
}): Promise<BulkActionResult> {
  const access = await requireOperationsAccess();
  const parsed = parseBulkIds(input.ids);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const orgScope = bookingOrgScopeParam(access);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const visible = await client.query<{ id: string }>(
      `SELECT booking.id::text
       FROM crm.bookings booking
       WHERE booking.id = ANY($1::uuid[])
         AND ($2::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($2::uuid[]))`,
      [parsed.ids, orgScope],
    );
    const allowed = new Set(visible.rows.map((row) => row.id));
    const skippedHidden = parsed.ids.filter((id) => !allowed.has(id)).length;
    const summary = await refreshBookingsFromCatalog(client, {
      bookingIds: parsed.ids.filter((id) => allowed.has(id)),
      actor: access.user,
    });
    await client.query("COMMIT");
    refreshCatalogLinkedViews({});
    return result(
      summary.updated,
      summary.skipped + skippedHidden,
      summary.failed,
      formatCatalogRefreshSummary(summary),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshAllLinkedBookingsFromCatalogAction(): Promise<BulkActionResult> {
  const access = await requireOperationsAccess();
  const orgScope = bookingOrgScopeParam(access);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const linked = await client.query<{ id: string }>(
      `
        SELECT booking.id::text
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
        JOIN crm.events event ON event.id = occurrence.event_id
        JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
        WHERE booking.archived_at IS NULL
          AND event.catalog_race_listing_id IS NOT NULL
          AND stage.key NOT IN ('paid', 'closed_lost')
          AND (occurrence.race_date IS NULL OR occurrence.race_date >= now())
          AND ($1::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($1::uuid[]))
      `,
      [orgScope],
    );
    const summary = await refreshBookingsFromCatalog(client, {
      bookingIds: linked.rows.map((row) => row.id),
      actor: access.user,
    });
    await client.query("COMMIT");
    refreshCatalogLinkedViews({});
    return result(
      summary.updated,
      summary.skipped,
      summary.failed,
      formatCatalogRefreshSummary(summary),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bulkUpdateContactsAction(input: {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
}): Promise<BulkActionResult> {
  const access = await requireContactsAccess();
  if (!access.canAccessOperations) {
    return result(0, 0, 0, "You cannot mass-update contacts.");
  }
  const parsed = parsePayload(input);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const allowed = validateBulkUpdate("contacts", parsed);
  if (!allowed.success) return result(0, 0, parsed.ids.length, allowed.error);
  if (
    isDestructiveBulkUpdate("contacts", parsed.field, parsed.value) &&
    input.extra?.confirmed !== "1"
  ) {
    return result(0, 0, 0, "Confirm this change before applying it.");
  }
  const scope = await loadContactOrgScope(access);
  const isActive = parsed.value === "active";
  const changed = await getPool().query<{ id: string }>(
    `
      UPDATE crm.people person
      SET is_active = $4, updated_at = now()
      WHERE person.id = ANY($3::uuid[])
        AND person.archived_at IS NULL
        AND ${personInContactScopeSql(1, 2)}
        AND person.is_active IS DISTINCT FROM $4
      RETURNING person.id::text
    `,
    [scope.scopeOrgIds, scope.assignedOrgIds, parsed.ids, isActive],
  );
  revalidatePath("/contacts");
  revalidatePath("/organizations");
  const updated = changed.rowCount ?? 0;
  return result(updated, parsed.ids.length - updated, 0);
}

export async function bulkUpdateOrganizationsAction(input: {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
}): Promise<BulkActionResult> {
  const user = await requireAdmin();
  const parsed = parsePayload(input);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const allowed = validateBulkUpdate("organizations", parsed);
  if (!allowed.success) return result(0, 0, parsed.ids.length, allowed.error);
  if (
    isDestructiveBulkUpdate("organizations", parsed.field, parsed.value) &&
    input.extra?.confirmed !== "1"
  ) {
    return result(0, 0, 0, "Confirm this change before applying it.");
  }
  const restore = parsed.value === "active";
  const changed = await getPool().query<{ id: string }>(
    `UPDATE crm.organizations
     SET is_active = $2,
         archived_at = CASE WHEN $2 THEN NULL ELSE now() END,
         archived_by_user_id = CASE WHEN $2 THEN NULL ELSE $3::uuid END,
         updated_at = now()
     WHERE id = ANY($1::uuid[])
     RETURNING id::text`,
    [parsed.ids, restore, user.id],
  );
  revalidatePath("/organizations");
  const updated = changed.rowCount ?? 0;
  return result(updated, parsed.ids.length - updated, 0);
}

export async function bulkUpdateEventsAction(input: {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
}): Promise<BulkActionResult> {
  const access = await requireOperationsAccess();
  const parsed = parsePayload(input);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const allowed = validateBulkUpdate("events", parsed);
  if (!allowed.success) return result(0, 0, parsed.ids.length, allowed.error);
  const ownerId =
    !parsed.value || parsed.value === "__unassigned__" ? null : parsed.value;
  if (ownerId && !access.canAccessOrganization(ownerId)) {
    return result(0, 0, parsed.ids.length, "You cannot assign that organization.");
  }
  const orgScope = bookingOrgScopeParam(access);
  const changed = await getPool().query<{ id: string }>(
    `
      UPDATE crm.events event
      SET default_owner_organization_id = $2::uuid, updated_at = now()
      WHERE event.id = ANY($1::uuid[])
        AND event.default_owner_organization_id IS DISTINCT FROM $2::uuid
        AND (
          $3::uuid[] IS NULL
          OR event.default_owner_organization_id = ANY($3::uuid[])
          OR EXISTS (
            SELECT 1
            FROM crm.event_occurrences occurrence
            JOIN crm.bookings booking ON booking.occurrence_id = occurrence.id
            WHERE occurrence.event_id = event.id
              AND booking.direct_client_organization_id = ANY($3::uuid[])
          )
        )
      RETURNING event.id::text
    `,
    [parsed.ids, ownerId, orgScope],
  );
  revalidatePath("/events");
  const updated = changed.rowCount ?? 0;
  return result(updated, parsed.ids.length - updated, 0);
}

export async function bulkUpdateTasksAction(input: {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
}): Promise<BulkActionResult> {
  const access = await requireTasksAccess();
  const parsed = parsePayload(input);
  if (!parsed.success) return result(0, 0, 0, parsed.error);
  const allowed = validateBulkUpdate("tasks", parsed);
  if (!allowed.success) return result(0, 0, parsed.ids.length, allowed.error);
  if (
    isDestructiveBulkUpdate("tasks", parsed.field, parsed.value) &&
    input.extra?.confirmed !== "1"
  ) {
    return result(0, 0, 0, "Confirm this change before applying it.");
  }
  const userId = effectiveAccessUserId(access);
  const changed = await getPool().query<{ id: string }>(
    `
      UPDATE crm.tasks
      SET status = $2::crm.task_status,
          completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE NULL END,
          updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND (
          $4::boolean
          OR assigned_user_id = $3::uuid
          OR (
            $5::uuid[] IS NOT NULL
            AND (
              organization_id = ANY($5::uuid[])
              OR EXISTS (
                SELECT 1
                FROM crm.bookings booking
                WHERE booking.id = crm.tasks.booking_id
                  AND booking.direct_client_organization_id = ANY($5::uuid[])
              )
            )
          )
        )
        AND status IS DISTINCT FROM $2::crm.task_status
      RETURNING id::text
    `,
    [
      parsed.ids,
      parsed.value,
      userId,
      access.isSuperAdmin,
      access.isSuperAdmin ? null : access.assignedOrgIds,
    ],
  );
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  const updated = changed.rowCount ?? 0;
  return result(updated, parsed.ids.length - updated, 0);
}
