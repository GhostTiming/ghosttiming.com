"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import {
  requireBookingOperator,
  requireOperationsAccess,
  requireProspectingAccess,
} from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import {
  asCatalogQuery,
  autoLinkEventIfUnique,
  clearCatalogMatchDismissed,
  dismissCatalogMatch,
  linkEventToCatalogListing,
  loadCatalogListingCandidates,
  resolveCatalogListingQuery,
} from "@/lib/crm/catalog-link";
import { catalogListingSearchQuery } from "@/lib/crm/catalog-search";
import { renewBooking } from "@/lib/crm/booking-renewal";
import { findOrCreateStandingEvent, changeProspectStage } from "@/lib/crm/mutations";
import {
  linkEventToOnlineListing,
  unlinkEventFromOnlineListing,
  resolveOnlineListingId,
} from "@/lib/crm/online-listings";
import { earliestRunSignupStart } from "@/lib/crm/runsignup";
import {
  preferredCatalogEditionSql,
  recalculateOccurrenceTimes,
  shiftOccurrenceRaceTimes,
} from "@/lib/crm/race-operations";
import {
  BOOKING_READY_PREP_REQUIRED,
  parseClosedLostDetails,
} from "@/lib/crm/domain";
import { refreshCatalogLinkedViews } from "@/lib/crm/revalidate";
import { actionFailureResult } from "@/lib/next-control-flow";

const uuid = z.string().uuid();
const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/)
  .optional();

const optionalUrl = z.string().trim().url().max(2_000).optional();

export async function assertBookingStageRequirements(
  client: PoolClient,
  bookingId: string,
  stageKey: string,
) {
  if (stageKey === "ready") {
    const prep = await client.query<{ pending_count: number }>(
      `
        SELECT COUNT(*)::integer AS pending_count
        FROM crm.booking_prep_items
        WHERE booking_id = $1::uuid AND status = 'pending'
      `,
      [bookingId],
    );
    if ((prep.rows[0]?.pending_count ?? 0) > 0) {
      throw new Error(BOOKING_READY_PREP_REQUIRED);
    }
  }
  if (stageKey === "paid") {
    const pay = await client.query<{ amount_paid: string | null }>(
      `SELECT amount_paid::text FROM crm.bookings WHERE id = $1::uuid`,
      [bookingId],
    );
    const amount = Number(pay.rows[0]?.amount_paid ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Record amount paid before moving this booking to Paid.");
    }
  }
}

export async function convertProspectToBookingAction(formData: FormData) {
  const access = await requireProspectingAccess();
  const user = access.user;
  if (!access.canAccessOperations) {
    throw new Error("Operations access is required to convert a prospect.");
  }
  const prospectId = uuid.parse(formData.get("prospectId"));
  const directClientId = uuid.parse(formData.get("directClientId"));
  const eventOwnerId = uuid.parse(
    formData.get("eventOwnerId") || directClientId,
  );
  if (!access.canAccessOrganization(directClientId)) {
    throw new Error("You cannot convert this prospect to that client organization.");
  }
  if (!access.canAccessOrganization(eventOwnerId)) {
    throw new Error("You cannot assign that event owner organization.");
  }
  const expectedRevenue = access.canViewFinancials(directClientId)
    ? money.parse(formData.get("expectedRevenue") || undefined)
    : undefined;
  const existingConversion = await getPool().query<{
    converted_booking_id: string | null;
  }>(
    `SELECT converted_booking_id::text FROM crm.prospects WHERE id = $1::uuid`,
    [prospectId],
  );
  if (existingConversion.rows[0]?.converted_booking_id) {
    redirect(`/bookings/${existingConversion.rows[0].converted_booking_id}`);
  }
  const client = await getPool().connect();
  let bookingId: string;
  let eventId: string | undefined;

  try {
    await client.query("BEGIN");
    const prospect = await client.query<{
      race_listing_id: string | null;
      race_edition_id: string | null;
      event_id: string | null;
      occurrence_id: string | null;
      assigned_user_id: string | null;
      stage_key: string;
      converted_booking_id: string | null;
      race_name: string;
      registration_url: string | null;
      race_date: Date | null;
      timezone: string | null;
      occurrence_year: number | null;
    }>(
      `
        SELECT
          p.race_listing_id,
          p.race_edition_id,
          p.event_id::text,
          p.occurrence_id::text,
          p.assigned_user_id::text,
          stage.key AS stage_key,
          p.converted_booking_id::text,
          COALESCE(crm_event.name, rl.name) AS race_name,
          COALESCE(
            occurrence.registration_url_override, crm_event.website,
            rl.registration_url, rl.external_race_url
          ) AS registration_url,
          COALESCE(occurrence.race_date, re.starts_at, rl.next_start_at) AS race_date,
          COALESCE(occurrence.timezone, re.timezone, rl.timezone) AS timezone,
          COALESCE(
            re.edition_year,
            EXTRACT(YEAR FROM rl.next_start_at)::integer,
            occurrence.occurrence_year
          )
            AS occurrence_year
        FROM crm.prospects p
        JOIN crm.pipeline_stages stage ON stage.id = p.stage_id
        LEFT JOIN catalog.race_listings rl ON rl.id = p.race_listing_id
        LEFT JOIN catalog.race_editions re ON re.id = p.race_edition_id
        LEFT JOIN crm.events crm_event ON crm_event.id = p.event_id
        LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = p.occurrence_id
        WHERE p.id = $1::uuid
        FOR UPDATE OF p
      `,
      [prospectId],
    );
    const source = prospect.rows[0];
    if (!source) throw new Error("Prospect not found.");
    if (source.converted_booking_id) {
      throw new Error("This prospect has already been converted.");
    }
    if (source.stage_key !== "confirmed") {
      await changeProspectStage(client, prospectId, "confirmed", {
        actorType: "human",
        actorUserId: user.id,
        actorName: user.name,
      });
    }

    await client.query(
      `
        INSERT INTO crm.organization_roles (organization_id, role)
        VALUES ($1::uuid, 'direct_client'), ($2::uuid, 'event_owner')
        ON CONFLICT (organization_id, role) DO NOTHING
      `,
      [directClientId, eventOwnerId],
    );
    eventId = source.event_id ?? undefined;
    if (eventId) {
      await client.query(
        `UPDATE crm.events
         SET default_owner_organization_id =
               COALESCE(default_owner_organization_id, $2::uuid),
             website = COALESCE(website, $3),
             updated_at = now()
         WHERE id = $1::uuid`,
        [eventId, eventOwnerId, source.registration_url],
      );
    } else {
      const event = await client.query<{ id: string }>(
        `
          INSERT INTO crm.events
            (name, catalog_race_listing_id, source_type,
             default_owner_organization_id, website)
          VALUES ($1, $2, 'other', $3::uuid, $4)
          RETURNING id::text
        `,
        [
          source.race_name,
          source.race_listing_id,
          eventOwnerId,
          source.registration_url,
        ],
      );
      eventId = event.rows[0].id;
    }

    let occurrenceId: string;
    if (source.occurrence_id) {
      occurrenceId = source.occurrence_id;
      await client.query(
        `UPDATE crm.event_occurrences
         SET event_owner_organization_id =
               COALESCE(event_owner_organization_id, $2::uuid),
             updated_at = now()
         WHERE id = $1::uuid`,
        [occurrenceId, eventOwnerId],
      );
    } else if (source.race_edition_id) {
      const occurrence = await client.query<{ id: string }>(
        `
          INSERT INTO crm.event_occurrences
            (event_id, catalog_race_edition_id, occurrence_year, race_date,
             timezone, event_owner_organization_id)
          VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
          RETURNING id::text
        `,
        [
          eventId,
          source.race_edition_id,
          source.occurrence_year,
          source.race_date,
          source.timezone,
          eventOwnerId,
        ],
      );
      occurrenceId = occurrence.rows[0].id;
    } else {
      const occurrence = await client.query<{ id: string }>(
        `
          INSERT INTO crm.event_occurrences
            (event_id, occurrence_year, race_date, timezone,
             event_owner_organization_id)
          VALUES ($1::uuid, $2, $3, $4, $5::uuid)
          RETURNING id::text
        `,
        [
          eventId,
          source.occurrence_year,
          source.race_date,
          source.timezone,
          eventOwnerId,
        ],
      );
      occurrenceId = occurrence.rows[0].id;
    }

    const booking = await client.query<{ id: string }>(
      `
        INSERT INTO crm.bookings
          (occurrence_id, direct_client_organization_id, stage_id,
           assigned_user_id, expected_revenue)
        SELECT $1::uuid, $2::uuid, stage.id, $3::uuid, $4::numeric
        FROM crm.pipeline_stages stage
        WHERE stage.pipeline = 'booking' AND stage.key = 'confirmed'
        ON CONFLICT (occurrence_id)
        DO UPDATE SET updated_at = now()
        RETURNING id::text
      `,
      [
        occurrenceId,
        directClientId,
        source.assigned_user_id,
        expectedRevenue ?? null,
      ],
    );
    bookingId = booking.rows[0].id;
    if (!eventId) throw new Error("Event not found.");
    if (source.race_listing_id) {
      const linked = await client.query<{ catalog_race_listing_id: string | null }>(
        `SELECT catalog_race_listing_id FROM crm.events WHERE id = $1::uuid`,
        [eventId],
      );
      if (!linked.rows[0]?.catalog_race_listing_id) {
        await linkEventToCatalogListing(client, {
          eventId,
          listingId: source.race_listing_id,
          occurrenceId,
          actor: user,
          archiveProspects: false,
        });
      }
    }
    await client.query(
      `
        INSERT INTO crm.booking_prep_items (booking_id, key, label)
        VALUES
          ($1::uuid, 'crew_email_sent', 'Crew email sent'),
          ($1::uuid, 'race_built', 'Race built')
        ON CONFLICT (booking_id, key) DO NOTHING
      `,
      [bookingId],
    );
    await client.query(
      `
        UPDATE crm.prospects
        SET converted_booking_id = $2::uuid, closed_at = COALESCE(closed_at, now()),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [prospectId, bookingId],
    );
    await client.query(
      `
        INSERT INTO crm.activities
          (prospect_id, type, body, actor_type, actor_user_id, actor_name, metadata)
        VALUES (
          $1::uuid, 'note', 'Converted to Booking', 'human', $2::uuid, $3,
          jsonb_build_object('booking_id', $4::text)
        )
      `,
      [prospectId, user.id, user.name, bookingId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId, eventId, prospectId });
  redirect(`/bookings/${bookingId}`);
}

const bookingStageKeys = [
  "awaiting_decision",
  "confirmed",
  "pre_event_prep",
  "ready",
  "completed",
  "paid",
  "closed_lost",
] as const;

export async function changeBookingStageAction(formData: FormData) {
  try {
    const bookingId = uuid.parse(formData.get("bookingId"));
    const { user } = await requireBookingOperator(bookingId);
    const stageKey = z.enum(bookingStageKeys).parse(formData.get("stageKey"));
    const closedLost =
      stageKey === "closed_lost"
        ? parseClosedLostDetails({
            reason: String(formData.get("closedLostReason") ?? "") || null,
            note: String(formData.get("closedLostNote") ?? "") || null,
            circleBackOn: String(formData.get("circleBackOn") ?? "") || null,
          })
        : null;
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await assertBookingStageRequirements(client, bookingId, stageKey);
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
                closed_lost_reason = CASE
                  WHEN target.key = 'closed_lost' THEN $3
                  ELSE bookings.closed_lost_reason
                END,
                closed_lost_note = CASE
                  WHEN target.key = 'closed_lost' THEN $4
                  ELSE bookings.closed_lost_note
                END,
                circle_back_on = CASE
                  WHEN target.key = 'closed_lost' THEN $5::date
                  ELSE bookings.circle_back_on
                END,
                updated_at = now()
            FROM target, previous
            WHERE bookings.id = $1::uuid AND bookings.stage_id <> target.id
            RETURNING previous.old_name, target.name AS new_name
          )
          SELECT old_name, new_name FROM updated
        `,
        [
          bookingId,
          stageKey,
          closedLost?.reason ?? null,
          closedLost?.note ?? null,
          closedLost?.circleBackOn ?? null,
        ],
      );
      if (changed.rows[0]) {
        await client.query(
          `
            INSERT INTO crm.activities
              (booking_id, type, body, actor_type, actor_user_id, actor_name)
            VALUES ($1::uuid, 'stage_change', $2, 'human', $3::uuid, $4)
          `,
          [
            bookingId,
            `Booking changed from ${changed.rows[0].old_name} to ${changed.rows[0].new_name}`,
            user.id,
            user.name,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    refreshCatalogLinkedViews({ bookingId });
    return { ok: true as const };
  } catch (error) {
    return actionFailureResult(error, "Could not save stage.");
  }
}

export async function saveBookingPrepItemsAction(formData: FormData) {
  try {
    const bookingId = uuid.parse(formData.get("bookingId"));
    const { user } = await requireBookingOperator(bookingId);
    const itemIds = formData
      .getAll("itemId")
      .map((value) => uuid.parse(value));
    if (itemIds.length === 0) {
      throw new Error("Add at least one prep item before saving.");
    }
    const items = itemIds.map((itemId) => ({
      itemId,
      status: z
        .enum(["pending", "complete", "not_applicable"])
        .parse(formData.get(`status_${itemId}`)),
      notes: z
        .string()
        .trim()
        .max(5_000)
        .optional()
        .parse(formData.get(`notes_${itemId}`) || undefined),
    }));
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      for (const item of items) {
        const changed = await client.query<{ label: string }>(
          `
            UPDATE crm.booking_prep_items
            SET status = $3::crm.prep_item_status,
                notes = $4,
                updated_by_user_id = $5::uuid,
                updated_at = now()
            WHERE id = $2::uuid AND booking_id = $1::uuid
            RETURNING label
          `,
          [
            bookingId,
            item.itemId,
            item.status,
            item.notes ?? null,
            user.id,
          ],
        );
        if (!changed.rows[0]) throw new Error("Prep item not found.");
      }
      await client.query(
        `
          INSERT INTO crm.activities
            (booking_id, type, body, actor_type, actor_user_id, actor_name)
          VALUES ($1::uuid, 'note', $2, 'human', $3::uuid, $4)
        `,
        [bookingId, "Pre-event prep updated", user.id, user.name],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (formData.get("markReady") === "1") {
      const stageForm = new FormData();
      stageForm.set("bookingId", bookingId);
      stageForm.set("stageKey", "ready");
      return changeBookingStageAction(stageForm);
    }
    refreshCatalogLinkedViews({ bookingId });
    return { ok: true as const };
  } catch (error) {
    return actionFailureResult(error, "Could not save prep.");
  }
}

export async function updateBookingFinancialsAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user, access, organizationId } = await requireBookingOperator(bookingId);
  if (!access.canViewFinancials(organizationId)) {
    throw new Error("You cannot update booking financials.");
  }
  const values = {
    expected: money.parse(formData.get("expectedRevenue") || undefined),
    actual: money.parse(formData.get("actualRevenue") || undefined),
    paid: money.parse(formData.get("amountPaid") || undefined),
    notes: z.string().trim().max(20_000).parse(formData.get("notes") || ""),
    completedAt: z.string().optional().parse(formData.get("completedAt") || undefined),
    paymentDueAt: z.string().optional().parse(formData.get("paymentDueAt") || undefined),
    paymentAt: z.string().optional().parse(formData.get("paymentAt") || undefined),
  };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `
        UPDATE crm.bookings
        SET expected_revenue = $2::numeric,
            actual_revenue = $3::numeric,
            amount_paid = COALESCE($4::numeric, 0),
            notes = NULLIF($5, ''),
            completed_at = $6::timestamp AT TIME ZONE 'America/New_York',
            payment_due_at = $7::timestamp AT TIME ZONE 'America/New_York',
            payment_at = $8::timestamp AT TIME ZONE 'America/New_York',
            updated_at = now()
        WHERE id = $1::uuid
        RETURNING id
      `,
      [
        bookingId,
        values.expected ?? null,
        values.actual ?? null,
        values.paid,
        values.notes,
        values.completedAt ?? null,
        values.paymentDueAt ?? null,
        values.paymentAt ?? null,
      ],
    );
    if (!changed.rowCount) throw new Error("Booking not found.");
    await appendAuditActivity(client, { bookingId }, user, "Financial details updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");
  redirect(`/bookings/${bookingId}`);
}

const optionalUuid = z.string().uuid().optional();

export async function updateBookingEventAction(formData: FormData) {
  const input = z.object({
    bookingId: uuid,
    occurrenceId: uuid,
    eventName: z.string().trim().min(1).max(500),
    raceDate: z.string().optional(),
    timezone: z.string().trim().min(1).max(100),
    registrationUrl: optionalUrl,
    street: z.string().trim().max(500).optional(),
    street2: z.string().trim().max(500).optional(),
    city: z.string().trim().max(200).optional(),
    state: z.string().trim().max(100).optional(),
    zipcode: z.string().trim().max(30).optional(),
  }).parse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    eventName: formData.get("eventName"),
    raceDate: formData.get("raceDate") || undefined,
    timezone: formData.get("timezone") || "America/New_York",
    registrationUrl: formData.get("registrationUrl") || undefined,
    street: formData.get("street") || undefined,
    street2: formData.get("street2") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    zipcode: formData.get("zipcode") || undefined,
  });
  const { user } = await requireBookingOperator(input.bookingId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query<{ race_date: string | null }>(
      `SELECT race_date::text FROM crm.event_occurrences
       WHERE id = $1::uuid FOR UPDATE`,
      [input.occurrenceId],
    );
    const changed = await client.query(
      `
        UPDATE crm.event_occurrences occurrence
        SET race_date = CASE WHEN $3::text IS NULL THEN NULL
              ELSE $3::timestamp AT TIME ZONE $4 END,
            occurrence_year = CASE WHEN $3::text IS NULL THEN occurrence_year
              ELSE EXTRACT(YEAR FROM $3::timestamp)::integer END,
            timezone = $4,
            registration_url_override = $5,
            street_override = $6, street2_override = $7,
            city_override = $8, state_override = $9, zipcode_override = $10,
            updated_at = now()
        FROM crm.bookings booking
        WHERE booking.id = $1::uuid
          AND booking.occurrence_id = occurrence.id
          AND occurrence.id = $2::uuid
        RETURNING occurrence.event_id
      `,
      [
        input.bookingId,
        input.occurrenceId,
        input.raceDate ?? null,
        input.timezone,
        input.registrationUrl ?? null,
        input.street ?? null,
        input.street2 ?? null,
        input.city ?? null,
        input.state ?? null,
        input.zipcode ?? null,
      ],
    );
    if (!changed.rows[0]) throw new Error("Booking occurrence not found.");
    await client.query(
      `UPDATE crm.events SET name = $2, website = $3, updated_at = now()
       WHERE id = $1`,
      [changed.rows[0].event_id, input.eventName, input.registrationUrl ?? null],
    );
    await shiftOccurrenceRaceTimes(
      client,
      input.occurrenceId,
      previous.rows[0]?.race_date ?? null,
      input.raceDate ?? null,
      input.timezone,
    );
    await recalculateOccurrenceTimes(client, input.occurrenceId);
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      "Event details updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/bookings/${input.bookingId}`);
  revalidatePath("/bookings");
  redirect(`/bookings/${input.bookingId}`);
}

export async function updateBookingRelationshipsAction(formData: FormData) {
  const input = z.object({
    bookingId: uuid,
    occurrenceId: uuid,
    directClientId: uuid,
    eventOwnerId: optionalUuid,
    primaryContactPersonId: optionalUuid,
    assignedUserId: optionalUuid,
  }).parse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    directClientId: formData.get("directClientId"),
    eventOwnerId: formData.get("eventOwnerId") || undefined,
    primaryContactPersonId: formData.get("primaryContactPersonId") || undefined,
    assignedUserId: formData.get("assignedUserId") || undefined,
  });
  const { user, access } = await requireBookingOperator(input.bookingId);
  if (!access.canAccessOrganization(input.directClientId)) {
    throw new Error("You cannot assign this booking to that client organization.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `
        UPDATE crm.bookings
        SET direct_client_organization_id = $2::uuid,
            primary_contact_person_id = $3::uuid,
            assigned_user_id = $4::uuid,
            updated_at = now()
        WHERE id = $1::uuid AND occurrence_id = $5::uuid
        RETURNING id
      `,
      [input.bookingId, input.directClientId,
        input.primaryContactPersonId ?? null, input.assignedUserId ?? null,
        input.occurrenceId],
    );
    if (!changed.rowCount) throw new Error("Booking not found.");
    await client.query(
      `UPDATE crm.event_occurrences
       SET event_owner_organization_id = $2::uuid, updated_at = now()
       WHERE id = $1::uuid`,
      [input.occurrenceId, input.eventOwnerId ?? null],
    );
    await client.query(
      `INSERT INTO crm.organization_roles (organization_id, role)
       VALUES ($1::uuid, 'direct_client')
       ON CONFLICT (organization_id, role) DO NOTHING`,
      [input.directClientId],
    );
    if (input.eventOwnerId) {
      await client.query(
        `INSERT INTO crm.organization_roles (organization_id, role)
         VALUES ($1::uuid, 'event_owner')
         ON CONFLICT (organization_id, role) DO NOTHING`,
        [input.eventOwnerId],
      );
    }
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      "Client, owner, contact, or assignee updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/bookings/${input.bookingId}`);
  revalidatePath("/bookings");
  redirect(`/bookings/${input.bookingId}`);
}

export async function createManualBookingAction(formData: FormData) {
  const access = await requireOperationsAccess();
  const user = access.user;
  const input = z.object({
    eventName: z.string().trim().min(1).max(500),
    raceDate: z.string().min(1),
    timezone: z.string().trim().min(1).max(100),
    directClientId: uuid,
    eventOwnerId: optionalUuid,
    primaryContactPersonId: optionalUuid,
    assignedUserId: optionalUuid,
    stageKey: z.enum(bookingStageKeys),
    expectedRevenue: money,
    registrationUrl: optionalUrl,
    street: z.string().trim().max(500).optional(),
    street2: z.string().trim().max(500).optional(),
    city: z.string().trim().max(200).optional(),
    state: z.string().trim().max(100).optional(),
    zipcode: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(20_000).optional(),
  }).parse({
    eventName: formData.get("eventName"),
    raceDate: formData.get("raceDate"),
    timezone: formData.get("timezone") || "America/New_York",
    directClientId: formData.get("directClientId"),
    eventOwnerId: formData.get("eventOwnerId") || undefined,
    primaryContactPersonId: formData.get("primaryContactPersonId") || undefined,
    assignedUserId: formData.get("assignedUserId") || undefined,
    stageKey: formData.get("stageKey") || "confirmed",
    expectedRevenue: formData.get("expectedRevenue") || undefined,
    registrationUrl: formData.get("registrationUrl") || undefined,
    street: formData.get("street") || undefined,
    street2: formData.get("street2") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    zipcode: formData.get("zipcode") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!access.canAccessOrganization(input.directClientId)) {
    throw new Error("You cannot create a booking for that client organization.");
  }
  const expectedRevenue = access.canViewFinancials(input.directClientId)
    ? input.expectedRevenue
    : undefined;
  const client = await getPool().connect();
  let bookingId = "";
  try {
    await client.query("BEGIN");
    const eventId = await findOrCreateStandingEvent(client, {
      name: input.eventName,
      ownerOrganizationId: input.eventOwnerId ?? null,
      website: input.registrationUrl ?? null,
    });
    const occurrence = await client.query<{ id: string }>(
      `INSERT INTO crm.event_occurrences
        (event_id, occurrence_year, race_date, timezone,
         event_owner_organization_id, registration_url_override,
         street_override, street2_override, city_override, state_override,
         zipcode_override)
       VALUES ($1::uuid, EXTRACT(YEAR FROM $2::timestamp)::integer,
         $2::timestamp AT TIME ZONE $3, $3, $4::uuid, $5, $6, $7, $8, $9, $10)
       RETURNING id::text`,
      [eventId, input.raceDate, input.timezone,
        input.eventOwnerId ?? null, input.registrationUrl ?? null,
        input.street ?? null, input.street2 ?? null, input.city ?? null,
        input.state ?? null, input.zipcode ?? null],
    );
    const booking = await client.query<{ id: string }>(
      `INSERT INTO crm.bookings
        (occurrence_id, direct_client_organization_id,
         primary_contact_person_id, stage_id, assigned_user_id,
         expected_revenue, notes)
       SELECT $1::uuid, $2::uuid, $3::uuid, stage.id, $4::uuid,
         $5::numeric, $6
       FROM crm.pipeline_stages stage
       WHERE stage.pipeline = 'booking' AND stage.key = $7 AND stage.is_active
       RETURNING id::text`,
      [occurrence.rows[0].id, input.directClientId,
        input.primaryContactPersonId ?? null, input.assignedUserId ?? user.id,
        expectedRevenue ?? null, input.notes ?? null,
        input.stageKey === "ready" || input.stageKey === "paid"
          ? "confirmed"
          : input.stageKey],
    );
    if (!booking.rows[0]) throw new Error("Booking stage not found.");
    bookingId = booking.rows[0].id;
    await client.query(
      `INSERT INTO crm.booking_prep_items (booking_id, key, label)
       VALUES
         ($1::uuid, 'crew_email_sent', 'Crew email sent'),
         ($1::uuid, 'race_built', 'Race built')
       ON CONFLICT (booking_id, key) DO NOTHING`,
      [bookingId],
    );
    await client.query(
      `INSERT INTO crm.organization_roles (organization_id, role)
       VALUES ($1::uuid, 'direct_client')
       ON CONFLICT (organization_id, role) DO NOTHING`,
      [input.directClientId],
    );
    if (input.eventOwnerId) {
      await client.query(
        `INSERT INTO crm.organization_roles (organization_id, role)
         VALUES ($1::uuid, 'event_owner')
         ON CONFLICT (organization_id, role) DO NOTHING`,
        [input.eventOwnerId],
      );
    }
    await appendAuditActivity(client, { bookingId }, user,
      "Manual booking created");
    await autoLinkEventIfUnique(client, {
      eventId,
      occurrenceId: occurrence.rows[0].id,
      actor: user,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId });
  redirect(`/bookings/${bookingId}`);
}

export async function createBookingFromOnlineListingAction(formData: FormData) {
  const access = await requireOperationsAccess();
  const user = access.user;
  const input = z
    .object({
      listingId: z.string().trim().min(1).max(200),
      directClientId: uuid,
      eventOwnerId: optionalUuid,
      primaryContactPersonId: optionalUuid,
      assignedUserId: optionalUuid,
      stageKey: z.enum(bookingStageKeys),
      expectedRevenue: money,
    })
    .parse({
      listingId: formData.get("listingId"),
      directClientId: formData.get("directClientId"),
      eventOwnerId: formData.get("eventOwnerId") || undefined,
      primaryContactPersonId: formData.get("primaryContactPersonId") || undefined,
      assignedUserId: formData.get("assignedUserId") || undefined,
      stageKey: formData.get("stageKey") || "confirmed",
      expectedRevenue: formData.get("expectedRevenue") || undefined,
    });
  if (!access.canAccessOrganization(input.directClientId)) {
    throw new Error("You cannot create a booking for that client organization.");
  }
  if (input.eventOwnerId && !access.canAccessOrganization(input.eventOwnerId)) {
    throw new Error("You cannot assign that event owner organization.");
  }
  const expectedRevenue = access.canViewFinancials(input.directClientId)
    ? input.expectedRevenue
    : undefined;
  const resolved = await resolveOnlineListingId(input.listingId);
  const client = await getPool().connect();
  let bookingId = "";
  try {
    await client.query("BEGIN");
    let eventName = "";
    let website: string | null = null;
    let timezone = "America/New_York";
    let raceDate: Date | null = null;
    let raceDateLocal: string | null = null;
    let occurrenceYear: number | null = null;
    let street: string | null = null;
    let street2: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let zipcode: string | null = null;
    let existingEventId: string | null = null;

    if (resolved.kind === "catalog") {
      const listing = await client.query<{
        name: string;
        city: string | null;
        state: string | null;
        zipcode: string | null;
        street: string | null;
        street2: string | null;
        website: string | null;
        timezone: string | null;
        race_date: Date | null;
        occurrence_year: number | null;
        existing_event_id: string | null;
      }>(
        `
          SELECT listing.name,
                 listing.city,
                 listing.state,
                 listing.zipcode,
                 listing.street,
                 listing.street2,
                 COALESCE(listing.registration_url, listing.external_race_url) AS website,
                 COALESCE(edition.timezone, listing.timezone, 'America/New_York') AS timezone,
                 COALESCE(edition.starts_at, listing.next_start_at) AS race_date,
                 COALESCE(
                   edition.edition_year,
                   EXTRACT(YEAR FROM COALESCE(edition.starts_at, listing.next_start_at))::integer
                 ) AS occurrence_year,
                 (
                   SELECT event.id::text
                   FROM crm.events event
                   WHERE event.catalog_race_listing_id = listing.id
                     AND event.archived_at IS NULL
                   ORDER BY event.created_at
                   LIMIT 1
                 ) AS existing_event_id
          FROM catalog.race_listings listing
          LEFT JOIN catalog.race_editions edition
            ON edition.id = ${preferredCatalogEditionSql("$1")}
          WHERE listing.id = $1
        `,
        [resolved.listingId],
      );
      const row = listing.rows[0];
      if (!row) throw new Error("That online listing was not found.");
      eventName = row.name;
      website = row.website;
      timezone = row.timezone?.trim() || "America/New_York";
      raceDate = row.race_date;
      occurrenceYear = row.occurrence_year;
      street = row.street;
      street2 = row.street2;
      city = row.city;
      state = row.state;
      zipcode = row.zipcode;
      existingEventId = row.existing_event_id;
    } else {
      const race = resolved.race;
      const start = earliestRunSignupStart(race);
      eventName = race.name;
      website = race.url ?? race.external_race_url ?? null;
      timezone = race.timezone?.trim() || "America/New_York";
      raceDateLocal = start?.local ?? null;
      occurrenceYear = start?.year ?? null;
      street = race.address?.street ?? null;
      street2 = race.address?.street2 ?? null;
      city = race.address?.city ?? null;
      state = race.address?.state ?? null;
      zipcode = race.address?.zipcode ?? null;
      const existing = await client.query<{ id: string }>(
        `SELECT id::text
         FROM crm.events
         WHERE archived_at IS NULL
           AND source_type = 'runsignup'
           AND external_source_id = $1
         ORDER BY created_at
         LIMIT 1`,
        [String(race.race_id)],
      );
      existingEventId = existing.rows[0]?.id ?? null;
    }

    const eventId =
      existingEventId ??
      (
        await client.query<{ id: string }>(
          `INSERT INTO crm.events
            (name, source_type, default_owner_organization_id, website)
           VALUES ($1, 'manual', $2::uuid, $3)
           RETURNING id::text`,
          [eventName, input.eventOwnerId ?? null, website],
        )
      ).rows[0].id;

    const occurrence = await client.query<{ id: string }>(
      `INSERT INTO crm.event_occurrences
        (event_id, occurrence_year, race_date, timezone,
         event_owner_organization_id, registration_url_override,
         street_override, street2_override, city_override, state_override,
         zipcode_override)
       VALUES (
         $1::uuid,
         COALESCE($2, EXTRACT(YEAR FROM COALESCE($3::timestamptz, CASE
           WHEN $4::text IS NOT NULL THEN $4::timestamp AT TIME ZONE $5
           ELSE NULL
         END))::integer),
         COALESCE(
           $3::timestamptz,
           CASE WHEN $4::text IS NOT NULL THEN $4::timestamp AT TIME ZONE $5 ELSE NULL END
         ),
         $5, $6::uuid, $7, $8, $9, $10, $11, $12
       )
       RETURNING id::text`,
      [
        eventId,
        occurrenceYear,
        raceDate,
        raceDateLocal,
        timezone,
        input.eventOwnerId ?? null,
        website,
        street,
        street2,
        city,
        state,
        zipcode,
      ],
    );
    const booking = await client.query<{ id: string }>(
      `INSERT INTO crm.bookings
        (occurrence_id, direct_client_organization_id,
         primary_contact_person_id, stage_id, assigned_user_id,
         expected_revenue)
       SELECT $1::uuid, $2::uuid, $3::uuid, stage.id, $4::uuid, $5::numeric
       FROM crm.pipeline_stages stage
       WHERE stage.pipeline = 'booking' AND stage.key = $6 AND stage.is_active
       RETURNING id::text`,
      [
        occurrence.rows[0].id,
        input.directClientId,
        input.primaryContactPersonId ?? null,
        input.assignedUserId ?? user.id,
        expectedRevenue ?? null,
        input.stageKey === "ready" || input.stageKey === "paid"
          ? "confirmed"
          : input.stageKey,
      ],
    );
    if (!booking.rows[0]) throw new Error("Booking stage not found.");
    bookingId = booking.rows[0].id;
    await client.query(
      `INSERT INTO crm.booking_prep_items (booking_id, key, label)
       VALUES
         ($1::uuid, 'crew_email_sent', 'Crew email sent'),
         ($1::uuid, 'race_built', 'Race built')
       ON CONFLICT (booking_id, key) DO NOTHING`,
      [bookingId],
    );
    await client.query(
      `INSERT INTO crm.organization_roles (organization_id, role)
       VALUES ($1::uuid, 'direct_client')
       ON CONFLICT (organization_id, role) DO NOTHING`,
      [input.directClientId],
    );
    if (input.eventOwnerId) {
      await client.query(
        `INSERT INTO crm.organization_roles (organization_id, role)
         VALUES ($1::uuid, 'event_owner')
         ON CONFLICT (organization_id, role) DO NOTHING`,
        [input.eventOwnerId],
      );
    }
    await linkEventToOnlineListing(client, {
      eventId,
      listingId: input.listingId,
      occurrenceId: occurrence.rows[0].id,
      actor: user,
    });
    await appendAuditActivity(
      client,
      { bookingId },
      user,
      "Booking created from online listing",
      { listingId: input.listingId },
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId });
  redirect(`/bookings/${bookingId}`);
}

function bookingReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const text = typeof value === "string" ? value : "";
  return text.startsWith("/bookings") ? text : fallback;
}

export async function matchBookingCatalogListingAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user } = await requireBookingOperator(bookingId);
  const listingIdValue = String(formData.get("listingId") ?? "").trim();
  const listingQuery = String(formData.get("listingQuery") ?? "").trim();
  const returnTo = bookingReturnTo(
    formData.get("returnTo"),
    `/bookings/${bookingId}`,
  );
  const client = await getPool().connect();
  let searchRedirect: string | null = null;
  let eventId: string | undefined;
  try {
    await client.query("BEGIN");
    const booking = await client.query<{
      event_id: string;
      occurrence_id: string;
      catalog_race_listing_id: string | null;
    }>(
      `SELECT event.id::text AS event_id,
              occurrence.id::text AS occurrence_id,
              event.catalog_race_listing_id
       FROM crm.bookings booking
       JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
       JOIN crm.events event ON event.id = occurrence.event_id
       WHERE booking.id = $1::uuid`,
      [bookingId],
    );
    const row = booking.rows[0];
    if (!row) throw new Error("Booking not found.");
    eventId = row.event_id;
    if (!row.catalog_race_listing_id) {
      let listingId = listingIdValue;
      if (!listingId && listingQuery) {
        const context = await loadCatalogListingCandidates(
          asCatalogQuery((sql, params) => client.query(sql, params)),
          { search: listingQuery },
        );
        const resolved = resolveCatalogListingQuery(
          listingQuery,
          context.listings,
          context.takenIds,
        );
        if ("match" in resolved && resolved.match) {
          listingId = resolved.match.id;
        } else {
          searchRedirect = `/bookings/${bookingId}?listingQ=${encodeURIComponent(listingQuery)}`;
        }
      }
      if (!searchRedirect) {
        if (!listingId) throw new Error("Choose an online listing to match.");
        const result = await linkEventToOnlineListing(client, {
          eventId: row.event_id,
          listingId,
          occurrenceId: row.occurrence_id,
          actor: user,
        });
        await appendAuditActivity(
          client,
          { bookingId },
          user,
          "Matched online listing",
          {
            raceListingId: listingId,
            archivedProspects: result.archivedCount,
          },
        );
      }
    }
    if (searchRedirect) await client.query("ROLLBACK");
    else await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId, eventId });
  redirect(searchRedirect ?? returnTo);
}

export async function dismissBookingCatalogMatchAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user } = await requireBookingOperator(bookingId);
  const returnTo = bookingReturnTo(
    formData.get("returnTo"),
    `/bookings/${bookingId}`,
  );
  const client = await getPool().connect();
  let eventId: string | undefined;
  try {
    await client.query("BEGIN");
    const booking = await client.query<{ event_id: string }>(
      `SELECT event.id::text AS event_id
       FROM crm.bookings booking
       JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
       JOIN crm.events event ON event.id = occurrence.event_id
       WHERE booking.id = $1::uuid`,
      [bookingId],
    );
    if (!booking.rows[0]) throw new Error("Booking not found.");
    eventId = booking.rows[0].event_id;
    await dismissCatalogMatch(client, eventId);
    await appendAuditActivity(
      client,
      { bookingId },
      user,
      "Marked as not in the online catalog",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId, eventId });
  redirect(returnTo);
}

export async function restoreBookingCatalogMatchAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user } = await requireBookingOperator(bookingId);
  const client = await getPool().connect();
  let eventId: string | undefined;
  let listingQuery = "";
  try {
    await client.query("BEGIN");
    const booking = await client.query<{
      event_id: string;
      event_name: string;
      city: string | null;
      state: string | null;
    }>(
      `SELECT event.id::text AS event_id,
              event.name AS event_name,
              occurrence.city_override AS city,
              occurrence.state_override AS state
       FROM crm.bookings booking
       JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
       JOIN crm.events event ON event.id = occurrence.event_id
       WHERE booking.id = $1::uuid`,
      [bookingId],
    );
    if (!booking.rows[0]) throw new Error("Booking not found.");
    eventId = booking.rows[0].event_id;
    listingQuery = catalogListingSearchQuery({
      name: booking.rows[0].event_name,
      city: booking.rows[0].city,
      state: booking.rows[0].state,
    });
    await clearCatalogMatchDismissed(client, eventId);
    await appendAuditActivity(
      client,
      { bookingId },
      user,
      "Undid not-an-online-listing mark",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId, eventId });
  const listingQ = listingQuery
    ? `?listingQ=${encodeURIComponent(listingQuery)}`
    : "";
  redirect(`/bookings/${bookingId}${listingQ}`);
}

export async function unlinkBookingCatalogListingAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user } = await requireBookingOperator(bookingId);
  const client = await getPool().connect();
  let eventId: string | undefined;
  let listingQuery = "";
  try {
    await client.query("BEGIN");
    const booking = await client.query<{
      event_id: string;
      event_name: string;
      city: string | null;
      state: string | null;
    }>(
      `SELECT event.id::text AS event_id,
              event.name AS event_name,
              occurrence.city_override AS city,
              occurrence.state_override AS state
       FROM crm.bookings booking
       JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
       JOIN crm.events event ON event.id = occurrence.event_id
       WHERE booking.id = $1::uuid`,
      [bookingId],
    );
    if (!booking.rows[0]) throw new Error("Booking not found.");
    eventId = booking.rows[0].event_id;
    listingQuery = catalogListingSearchQuery({
      name: booking.rows[0].event_name,
      city: booking.rows[0].city,
      state: booking.rows[0].state,
    });
    await unlinkEventFromOnlineListing(client, eventId);
    await appendAuditActivity(
      client,
      { bookingId },
      user,
      "Uncoupled online listing",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshCatalogLinkedViews({ bookingId, eventId });
  const listingQ = listingQuery
    ? `?listingQ=${encodeURIComponent(listingQuery)}`
    : "";
  redirect(`/bookings/${bookingId}${listingQ}`);
}

export async function renewBookingAction(formData: FormData) {
  const bookingId = uuid.parse(formData.get("bookingId"));
  const { user } = await requireBookingOperator(bookingId);
  const input = z
    .object({
      targetYear: z.coerce.number().int().min(2000).max(2100),
      refreshFromCatalog: z.boolean(),
      eventName: z.string().trim().min(1).max(500).optional(),
      raceDate: z.string().optional(),
      timezone: z.string().trim().min(1).max(100).optional(),
      registrationUrl: optionalUrl,
      street: z.string().trim().max(500).optional(),
      street2: z.string().trim().max(500).optional(),
      city: z.string().trim().max(200).optional(),
      state: z.string().trim().max(100).optional(),
      zipcode: z.string().trim().max(30).optional(),
    })
    .parse({
      targetYear: formData.get("targetYear"),
      refreshFromCatalog: formData.get("refreshFromCatalog") === "1",
      eventName: formData.get("eventName") || undefined,
      raceDate: formData.get("raceDate") || undefined,
      timezone: formData.get("timezone") || undefined,
      registrationUrl: formData.get("registrationUrl") || undefined,
      street: formData.get("street") || undefined,
      street2: formData.get("street2") || undefined,
      city: formData.get("city") || undefined,
      state: formData.get("state") || undefined,
      zipcode: formData.get("zipcode") || undefined,
    });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await renewBooking(client, {
      bookingId,
      actor: user,
      targetYear: input.targetYear,
      refreshFromCatalog: input.refreshFromCatalog,
      eventName: input.eventName,
      raceDateLocal: input.raceDate ?? null,
      timezone: input.timezone,
      registrationUrl: input.registrationUrl ?? null,
      street: input.street ?? null,
      street2: input.street2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      zipcode: input.zipcode ?? null,
    });
    await client.query("COMMIT");
    refreshCatalogLinkedViews({
      bookingId: result.bookingId,
      eventId: result.eventId,
    });
    revalidatePath(`/bookings/${bookingId}`);
    return { bookingId: result.bookingId };
  } catch (error) {
    await client.query("ROLLBACK");
    return {
      error:
        error instanceof Error ? error.message : "Could not renew this booking.",
    };
  } finally {
    client.release();
  }
}
