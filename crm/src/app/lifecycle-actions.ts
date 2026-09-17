"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import {
  requireAdmin,
  requireBookingOperator,
  requireProspectingUser,
} from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import { organizationDeletionBlockers } from "@/lib/crm/deletion";

const uuid = z.string().uuid();

export async function setBookingArchivedAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user } = await requireBookingOperator(bookingId);
  const restore = formData.get("operation") === "restore";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `UPDATE crm.bookings
       SET archived_at = CASE WHEN $2 THEN NULL ELSE now() END,
         archived_by_user_id = CASE WHEN $2 THEN NULL ELSE $3::uuid END,
         updated_at = now()
       WHERE id = $1::uuid RETURNING id`,
      [bookingId, restore, user.id],
    );
    if (!changed.rowCount) throw new Error("Booking not found.");
    await appendAuditActivity(client, { bookingId }, user,
      restore ? "Booking restored" : "Booking archived");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/bookings");
  redirect(restore ? `/bookings/${bookingId}` : "/bookings");
}

export async function permanentlyDeleteBookingAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { access, organizationId } = await requireBookingOperator(bookingId);
  if (!access.canViewFinancials(organizationId)) {
    throw new Error("Admin access is required to permanently delete a booking.");
  }
  if (formData.get("confirmation") !== "DELETE") {
    throw new Error('Type "DELETE" to permanently delete this booking.');
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const dependencies = await client.query<{
      converted_prospects: number;
    }>(
      `SELECT COUNT(*)::integer AS converted_prospects
       FROM crm.prospects WHERE converted_booking_id = $1::uuid`,
      [bookingId],
    );
    const count = dependencies.rows[0]?.converted_prospects ?? 0;
    if (count) {
      throw new Error(
        `Permanent deletion blocked: ${count} converted prospect(s) reference this booking.`,
      );
    }
    await client.query(`DELETE FROM crm.external_records
      WHERE entity_type = 'booking' AND local_id = $1::uuid`, [bookingId]);
    const record = await client.query<{ occurrence_id: string; event_id: string }>(
      `SELECT booking.occurrence_id::text, occurrence.event_id::text
       FROM crm.bookings booking
       JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
       WHERE booking.id = $1::uuid AND booking.archived_at IS NOT NULL
       FOR UPDATE OF booking`,
      [bookingId],
    );
    if (!record.rows[0]) {
      throw new Error("Archive the booking before permanently deleting it.");
    }
    await client.query(
      `DELETE FROM crm.bookings WHERE id = $1::uuid AND archived_at IS NOT NULL
       RETURNING occurrence_id`,
      [bookingId],
    );
    await client.query(
      `DELETE FROM crm.event_occurrences occurrence
       WHERE occurrence.id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM crm.prospects
           WHERE occurrence_id = occurrence.id)`,
      [record.rows[0].occurrence_id],
    );
    await client.query(
      `DELETE FROM crm.events event
       WHERE event.id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM crm.event_occurrences
           WHERE event_id = event.id)
         AND NOT EXISTS (SELECT 1 FROM crm.prospects WHERE event_id = event.id)`,
      [record.rows[0].event_id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/bookings");
  redirect("/bookings");
}

export async function setProspectArchivedAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const restore = formData.get("operation") === "restore";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `UPDATE crm.prospects
       SET archived_at = CASE WHEN $2 THEN NULL ELSE now() END,
         archived_by_user_id = CASE WHEN $2 THEN NULL ELSE $3::uuid END,
         updated_at = now()
       WHERE id = $1::uuid RETURNING id`,
      [prospectId, restore, user.id],
    );
    if (!changed.rowCount) throw new Error("Prospect not found.");
    await appendAuditActivity(client, { prospectId }, user,
      restore ? "Prospect restored" : "Prospect archived");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/prospecting");
  redirect(restore ? `/prospecting/${prospectId}` : "/prospecting");
}

export async function permanentlyDeleteProspectAction(formData: FormData) {
  const user = await requireProspectingUser();
  if (user.role !== "admin") throw new Error("Admin access required.");
  const prospectId = uuid.parse(formData.get("prospectId"));
  if (formData.get("confirmation") !== "DELETE") {
    throw new Error('Type "DELETE" to permanently delete this prospect.');
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const source = await client.query<{
      converted_booking_id: string | null;
      occurrence_id: string | null;
      event_id: string | null;
      primary_contact_person_id: string | null;
    }>(
      `SELECT converted_booking_id::text, occurrence_id::text, event_id::text,
         primary_contact_person_id::text
       FROM crm.prospects
       WHERE id = $1::uuid AND archived_at IS NOT NULL FOR UPDATE`,
      [prospectId],
    );
    if (!source.rows[0]) {
      throw new Error("Archive the prospect before permanently deleting it.");
    }
    if (source.rows[0].converted_booking_id) {
      throw new Error("Permanent deletion blocked: this prospect has a converted booking.");
    }
    await client.query(`DELETE FROM crm.external_records
      WHERE entity_type = 'prospect' AND local_id = $1::uuid`, [prospectId]);
    await client.query(`DELETE FROM crm.contact_methods
      WHERE prospect_id = $1::uuid`, [prospectId]);
    await client.query(`DELETE FROM crm.prospects WHERE id = $1::uuid`, [prospectId]);
    if (source.rows[0].primary_contact_person_id) {
      await client.query(
        `DELETE FROM crm.people person
         WHERE person.id = $1::uuid AND person.organization_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM crm.bookings
             WHERE primary_contact_person_id = person.id)
           AND NOT EXISTS (SELECT 1 FROM crm.prospects
             WHERE primary_contact_person_id = person.id)
           AND NOT EXISTS (SELECT 1 FROM crm.crew_assignments
             WHERE person_id = person.id)`,
        [source.rows[0].primary_contact_person_id],
      );
    }
    if (source.rows[0].occurrence_id) {
      await client.query(
        `DELETE FROM crm.event_occurrences occurrence
         WHERE occurrence.id = $1::uuid
           AND NOT EXISTS (SELECT 1 FROM crm.bookings
             WHERE occurrence_id = occurrence.id)
           AND NOT EXISTS (SELECT 1 FROM crm.prospects
             WHERE occurrence_id = occurrence.id)`,
        [source.rows[0].occurrence_id],
      );
    }
    if (source.rows[0].event_id) {
      await client.query(
        `DELETE FROM crm.events event WHERE event.id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM crm.event_occurrences
            WHERE event_id = event.id)
          AND NOT EXISTS (SELECT 1 FROM crm.prospects WHERE event_id = event.id)`,
        [source.rows[0].event_id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/prospecting");
  redirect("/prospecting");
}

export async function setOrganizationArchivedAction(formData: FormData) {
  const user = await requireAdmin();
  const organizationId = uuid.parse(formData.get("organizationId"));
  const restore = formData.get("operation") === "restore";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `UPDATE crm.organizations
       SET is_active = $2, archived_at = CASE WHEN $2 THEN NULL ELSE now() END,
         archived_by_user_id = CASE WHEN $2 THEN NULL ELSE $3::uuid END,
         updated_at = now()
       WHERE id = $1::uuid RETURNING id`,
      [organizationId, restore, user.id],
    );
    if (!changed.rowCount) throw new Error("Organization not found.");
    await appendAuditActivity(client, { organizationId }, user,
      restore ? "Organization restored" : "Organization archived");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/organizations");
  redirect(restore ? `/organizations/${organizationId}` : "/organizations");
}

export async function permanentlyDeleteOrganizationAction(formData: FormData) {
  await requireAdmin();
  const organizationId = uuid.parse(formData.get("organizationId"));
  if (formData.get("confirmation") !== "DELETE") {
    throw new Error('Type "DELETE" to permanently delete this organization.');
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const dependencies = await client.query<{
      bookings: number;
      occurrences: number;
      events: number;
      linked_people: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM crm.bookings
          WHERE direct_client_organization_id = $1::uuid)::integer AS bookings,
        (SELECT COUNT(*) FROM crm.event_occurrences
          WHERE event_owner_organization_id = $1::uuid)::integer AS occurrences,
        (SELECT COUNT(*) FROM crm.events
          WHERE default_owner_organization_id = $1::uuid)::integer AS events,
        (SELECT COUNT(DISTINCT person.id)
         FROM crm.people person
         WHERE (
           person.organization_id = $1::uuid
           OR EXISTS (
             SELECT 1 FROM crm.person_organizations membership
             WHERE membership.person_id = person.id
               AND membership.organization_id = $1::uuid
           )
         ) AND (
           EXISTS (SELECT 1 FROM crm.bookings WHERE primary_contact_person_id = person.id)
           OR EXISTS (SELECT 1 FROM crm.prospects
             WHERE primary_contact_person_id = person.id)
           OR EXISTS (SELECT 1 FROM crm.crew_assignments
             WHERE person_id = person.id)
         ))::integer AS linked_people`,
      [organizationId],
    );
    const counts = dependencies.rows[0];
    const blockers = organizationDeletionBlockers(counts);
    if (blockers.length) {
      throw new Error(`Permanent deletion blocked: ${blockers.join(", ")}.`);
    }
    const archived = await client.query(
      `SELECT 1 FROM crm.organizations
       WHERE id = $1::uuid AND archived_at IS NOT NULL FOR UPDATE`,
      [organizationId],
    );
    if (!archived.rowCount) {
      throw new Error("Archive the organization before permanently deleting it.");
    }
    await client.query(`DELETE FROM crm.external_records
      WHERE entity_type IN ('organization', 'account') AND local_id = $1::uuid`,
      [organizationId]);
    await client.query(
      `DELETE FROM crm.external_records external
       USING crm.people person
       WHERE (
         person.organization_id = $1::uuid
         OR EXISTS (
           SELECT 1 FROM crm.person_organizations membership
           WHERE membership.person_id = person.id
             AND membership.organization_id = $1::uuid
         )
       )
         AND NOT EXISTS (
           SELECT 1 FROM crm.person_organizations membership
           WHERE membership.person_id = person.id
             AND membership.organization_id <> $1::uuid
         )
         AND external.local_id = person.id
         AND external.entity_type IN ('person', 'contact')`,
      [organizationId],
    );
    await client.query(
      `DELETE FROM crm.people person
       WHERE (
         person.organization_id = $1::uuid
         OR EXISTS (
           SELECT 1 FROM crm.person_organizations membership
           WHERE membership.person_id = person.id
             AND membership.organization_id = $1::uuid
         )
       )
         AND NOT EXISTS (
           SELECT 1 FROM crm.person_organizations membership
           WHERE membership.person_id = person.id
             AND membership.organization_id <> $1::uuid
         )`,
      [organizationId],
    );
    await client.query(`DELETE FROM crm.organizations WHERE id = $1::uuid`,
      [organizationId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/organizations");
  revalidatePath("/contacts");
  redirect("/organizations");
}

