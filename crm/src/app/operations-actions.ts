"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireBookingOperator } from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import { addPersonOrganization } from "@/lib/crm/contact-queries";
import { resolvePersonDisplayName } from "@/lib/crm/contacts";
import { personTaggedToClientOrgSql } from "@/lib/crm/crew";
import { refreshCatalogLinkedViews } from "@/lib/crm/revalidate";
import {
  estimateRaceDurationMinutes,
  recalculateOccurrenceTimes,
} from "@/lib/crm/race-operations";
import {
  formatAgeGroupsField,
  formatAwardsField,
  isContactTimerBand,
  parseRaceScoring,
} from "@/lib/crm/race-scoring";
import {
  ageBandsForFileEvent,
  parseAgeGroupFile,
  scoringWithImportedAgeGroups,
} from "@/lib/crm/age-group-file";
import { refreshOccurrenceFromOnlineListing } from "@/lib/crm/online-listings";
import { actionFailureResult } from "@/lib/next-control-flow";

const uuid = z.string().uuid();
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional();
const optionalPositiveNumber = z.coerce.number().positive().optional();

function refreshBooking(bookingId: string) {
  refreshCatalogLinkedViews({ bookingId });
  revalidatePath("/contacts");
}

async function requireOperator(formData: FormData) {
  return requireBookingOperator(uuid.parse(formData.get("bookingId")));
}

function optionalFormField(formData: FormData, key: string) {
  if (!formData.has(key)) return { present: false, value: null as string | null };
  const value = String(formData.get(key) ?? "").trim();
  return { present: true, value: value || null };
}

export async function updateOccurrenceOperationsAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const timerLocation = optionalFormField(formData, "timerLocation");
  const hardwareEventName = optionalFormField(formData, "hardwareEventName");
  const scoringExpectations = optionalFormField(formData, "scoringExpectations");
  const postEventExpectations = optionalFormField(formData, "postEventExpectations");
  const notes = optionalFormField(formData, "operationsNotes");
  const arrivalOverride = optionalFormField(formData, "arrivalOverride");
  const departureOverride = optionalFormField(formData, "departureOverride");
  const input = z
    .object({
      bookingId: uuid,
      occurrenceId: uuid,
      timerLocation: z.enum(["on_site", "remote"]).nullable(),
      hardwareEventName: optionalText(500).nullable(),
      scoringExpectations: optionalText(20_000).nullable(),
      postEventExpectations: optionalText(20_000).nullable(),
      notes: optionalText(20_000).nullable(),
      arrivalOverride: z.string().nullable(),
      departureOverride: z.string().nullable(),
    })
    .parse({
      bookingId: formData.get("bookingId"),
      occurrenceId: formData.get("occurrenceId"),
      timerLocation: timerLocation.value,
      hardwareEventName: hardwareEventName.value,
      scoringExpectations: scoringExpectations.value,
      postEventExpectations: postEventExpectations.value,
      notes: notes.value,
      arrivalOverride: arrivalOverride.value,
      departureOverride: departureOverride.value,
    });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `
      UPDATE crm.event_occurrences occurrence
      SET timer_location = CASE WHEN $3::boolean THEN $4::crm.timer_location
            ELSE occurrence.timer_location END,
          hardware_event_name = CASE WHEN $5::boolean THEN $6
            ELSE occurrence.hardware_event_name END,
          scoring_expectations = CASE WHEN $7::boolean THEN $8
            ELSE occurrence.scoring_expectations END,
          post_event_expectations = CASE WHEN $9::boolean THEN $10
            ELSE occurrence.post_event_expectations END,
          notes = CASE WHEN $11::boolean THEN $12
            ELSE occurrence.notes END,
          arrival_override_at = CASE
            WHEN NOT $13::boolean THEN occurrence.arrival_override_at
            WHEN $14::text IS NULL THEN NULL
            ELSE $14::timestamp AT TIME ZONE
              COALESCE(occurrence.timezone, 'America/New_York') END,
          departure_override_at = CASE
            WHEN NOT $15::boolean THEN occurrence.departure_override_at
            WHEN $16::text IS NULL THEN NULL
            ELSE $16::timestamp AT TIME ZONE
              COALESCE(occurrence.timezone, 'America/New_York') END,
          updated_at = now()
      FROM crm.bookings booking
      WHERE occurrence.id = $2::uuid
        AND booking.id = $1::uuid
        AND booking.occurrence_id = occurrence.id
      RETURNING occurrence.id
      `,
      [
        input.bookingId,
        input.occurrenceId,
        timerLocation.present,
        input.timerLocation,
        hardwareEventName.present,
        input.hardwareEventName,
        scoringExpectations.present,
        input.scoringExpectations,
        postEventExpectations.present,
        input.postEventExpectations,
        notes.present,
        input.notes,
        arrivalOverride.present,
        input.arrivalOverride,
        departureOverride.present,
        input.departureOverride,
      ],
    );
    if (!changed.rowCount) throw new Error("Booking occurrence not found.");
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      "Race-day operations updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(input.bookingId);
}

export async function saveOccurrenceRaceAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const input = z
    .object({
      bookingId: uuid,
      occurrenceId: uuid,
      raceId: uuid.optional(),
      name: z.string().trim().min(1).max(500),
      distanceLabel: optionalText(100),
      distanceMiles: optionalPositiveNumber,
      distanceMeters: z.coerce.number().int().positive().optional(),
      startTime: z.string().min(1),
      ageGroupRules: z.string().optional(),
      awardRules: z.string().optional(),
      scoringNotes: optionalText(5_000),
      durationOverrideMinutes: z.coerce.number().int().positive().optional(),
    })
    .parse({
      bookingId: formData.get("bookingId"),
      occurrenceId: formData.get("occurrenceId"),
      raceId: formData.get("raceId") || undefined,
      name: formData.get("name"),
      distanceLabel: formData.get("distanceLabel") || undefined,
      distanceMiles: formData.get("distanceMiles") || undefined,
      distanceMeters: formData.get("distanceMeters") || undefined,
      startTime: formData.get("startTime"),
      ageGroupRules: formData.get("ageGroupRules") || undefined,
      awardRules: formData.get("awardRules") || undefined,
      scoringNotes: formData.get("scoringNotes") || undefined,
      durationOverrideMinutes:
        formData.get("durationOverrideMinutes") || undefined,
    });
  let parsedAgeGroups: unknown = [];
  let parsedAwards: unknown = [];
  try {
    parsedAgeGroups = JSON.parse(input.ageGroupRules || "[]");
    parsedAwards = JSON.parse(input.awardRules || "[]");
  } catch {
    throw new Error("Age groups or awards could not be saved. Try again.");
  }
  const scoring = parseRaceScoring({
    ageGroups: parsedAgeGroups,
    awards: parsedAwards,
    notes: input.scoringNotes ?? null,
  });
  const ageGroups = formatAgeGroupsField(scoring.ageGroups);
  const awards = formatAwardsField(scoring.awards);
  const estimatedDuration = estimateRaceDurationMinutes(
    input.distanceLabel,
    input.distanceMiles,
    input.distanceMeters,
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const validOccurrence = await client.query(
      `
        SELECT 1 FROM crm.bookings
        WHERE id = $1::uuid AND occurrence_id = $2::uuid
      `,
      [input.bookingId, input.occurrenceId],
    );
    if (!validOccurrence.rows[0]) throw new Error("Booking occurrence not found.");

    if (input.raceId) {
      await client.query(
        `
          UPDATE crm.occurrence_races
          SET name = $3, distance_label = $4, distance_miles = $5,
              distance_meters = $6, start_time = $7::timestamp,
              age_groups = $8, awards = $9, scoring = $10::jsonb,
              estimated_duration_minutes = $11,
              duration_override_minutes = $12, updated_at = now()
          WHERE id = $2::uuid AND occurrence_id = $1::uuid
        `,
        [
          input.occurrenceId,
          input.raceId,
          input.name,
          input.distanceLabel ?? null,
          input.distanceMiles ?? null,
          input.distanceMeters ?? null,
          input.startTime,
          ageGroups,
          awards,
          JSON.stringify(scoring),
          estimatedDuration,
          input.durationOverrideMinutes ?? null,
        ],
      );
    } else {
      await client.query(
        `
          INSERT INTO crm.occurrence_races
            (occurrence_id, name, distance_label, distance_miles,
             distance_meters, start_time, age_groups, awards, scoring,
             estimated_duration_minutes, duration_override_minutes, sort_order)
          SELECT
            $1::uuid, $2, $3, $4, $5, $6::timestamp, $7, $8, $9::jsonb, $10, $11,
            COALESCE(MAX(sort_order), -1) + 1
          FROM crm.occurrence_races
          WHERE occurrence_id = $1::uuid
        `,
        [
          input.occurrenceId,
          input.name,
          input.distanceLabel ?? null,
          input.distanceMiles ?? null,
          input.distanceMeters ?? null,
          input.startTime,
          ageGroups,
          awards,
          JSON.stringify(scoring),
          estimatedDuration,
          input.durationOverrideMinutes ?? null,
        ],
      );
    }
    await recalculateOccurrenceTimes(client, input.occurrenceId);
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      input.raceId ? `Race updated: ${input.name}` : `Race added: ${input.name}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(input.bookingId);
}

export async function importRaceAgeGroupsAction(formData: FormData) {
  try {
    const bookingId = uuid.parse(formData.get("bookingId"));
    const occurrenceId = uuid.parse(formData.get("occurrenceId"));
    const { user } = await requireBookingOperator(bookingId);
    let parsedFile: unknown;
    try {
      parsedFile = JSON.parse(String(formData.get("ageGroupFile") ?? ""));
    } catch {
      throw new Error("That Age Groups file could not be read.");
    }
    const file = parseAgeGroupFile(parsedFile);
    let rawMappings: unknown = {};
    try {
      rawMappings = JSON.parse(String(formData.get("eventMappings") ?? "{}"));
    } catch {
      throw new Error("Could not read the event mapping.");
    }
    if (!rawMappings || typeof rawMappings !== "object" || Array.isArray(rawMappings)) {
      throw new Error("Could not read the event mapping.");
    }
    const mappings = Object.fromEntries(
      Object.entries(rawMappings).map(([key, value]) => [
        key,
        value ? uuid.parse(value) : "",
      ]),
    );
    const assigned = new Map<string, number>();
    const updates = file.scoredEvents.flatMap((event) => {
      const raceId = mappings[String(event.scored_event_id)] ?? "";
      if (!raceId) return [];
      assigned.set(raceId, (assigned.get(raceId) ?? 0) + 1);
      return [
        {
          raceId,
          eventName: event.scored_event_name,
          ageGroups: ageBandsForFileEvent(file, event.scored_event_id),
        },
      ];
    });
    if (!updates.length) {
      throw new Error("Map at least one file event to a race.");
    }
    if ([...assigned.values()].some((count) => count > 1)) {
      throw new Error("Each CRM race can only receive one file event.");
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const validOccurrence = await client.query(
        `
          SELECT 1 FROM crm.bookings
          WHERE id = $1::uuid AND occurrence_id = $2::uuid
        `,
        [bookingId, occurrenceId],
      );
      if (!validOccurrence.rows[0]) throw new Error("Booking occurrence not found.");
      const imported: { raceId: string; raceName: string; ageGroupCount: number }[] = [];
      for (const update of updates) {
        const current = await client.query<{
          name: string;
          scoring: unknown;
        }>(
          `
            SELECT name, scoring
            FROM crm.occurrence_races
            WHERE id = $1::uuid AND occurrence_id = $2::uuid
          `,
          [update.raceId, occurrenceId],
        );
        if (!current.rows[0]) throw new Error("Race not found.");
        const scoring = scoringWithImportedAgeGroups(
          current.rows[0].scoring,
          update.ageGroups,
        );
        await client.query(
          `
            UPDATE crm.occurrence_races
            SET age_groups = $3, scoring = $4::jsonb, updated_at = now()
            WHERE id = $1::uuid AND occurrence_id = $2::uuid
          `,
          [
            update.raceId,
            occurrenceId,
            formatAgeGroupsField(scoring.ageGroups),
            JSON.stringify(scoring),
          ],
        );
        imported.push({
          raceId: update.raceId,
          raceName: current.rows[0].name,
          ageGroupCount: scoring.ageGroups.filter((band) => !isContactTimerBand(band))
            .length,
        });
      }
      await appendAuditActivity(
        client,
        { bookingId },
        user,
        `Imported age groups for ${imported
          .map((item) => item.raceName)
          .join(", ")}`,
      );
      await client.query("COMMIT");
      refreshBooking(bookingId);
      return {
        ok: true as const,
        imported,
        message: imported
          .map((item) =>
            item.ageGroupCount === 1
              ? `Imported 1 age group into ${item.raceName}.`
              : `Imported ${item.ageGroupCount} age groups into ${item.raceName}.`,
          )
          .join(" "),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return actionFailureResult(error, "Could not import age groups.");
  }
}

export async function deleteOccurrenceRaceAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const occurrenceId = uuid.parse(formData.get("occurrenceId"));
  const raceId = uuid.parse(formData.get("raceId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        DELETE FROM crm.occurrence_races race
        USING crm.bookings booking
        WHERE race.id = $3::uuid AND race.occurrence_id = $2::uuid
          AND booking.id = $1::uuid AND booking.occurrence_id = race.occurrence_id
      `,
      [bookingId, occurrenceId, raceId],
    );
    await recalculateOccurrenceTimes(client, occurrenceId);
    await appendAuditActivity(client, { bookingId }, user, "Race removed");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(bookingId);
}

export async function addCoursePointAction(formData: FormData) {
  await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const occurrenceId = uuid.parse(formData.get("occurrenceId"));
  const name = z.string().trim().min(1).max(300).parse(formData.get("name"));
  const hardwarePointName = optionalText(300).parse(
    formData.get("hardwarePointName") || undefined,
  );
  const notes = optionalText(5_000).parse(formData.get("notes") || undefined);
  await getPool().query(
    `
      INSERT INTO crm.course_points
        (occurrence_id, name, hardware_point_name, notes, sort_order)
      SELECT $2::uuid, $3, $4, $5,
        COALESCE(MAX(point.sort_order), -1) + 1
      FROM crm.bookings booking
      LEFT JOIN crm.course_points point ON point.occurrence_id = $2::uuid
      WHERE booking.id = $1::uuid AND booking.occurrence_id = $2::uuid
    `,
    [bookingId, occurrenceId, name, hardwarePointName ?? null, notes ?? null],
  );
  refreshBooking(bookingId);
}

export async function saveCoursePointAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const input = z.object({
    bookingId: uuid,
    occurrenceId: uuid,
    pointId: uuid.optional(),
    name: z.string().trim().min(1).max(300),
    hardwarePointName: optionalText(300),
    notes: optionalText(5_000),
  }).parse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    pointId: formData.get("pointId") || undefined,
    name: formData.get("name"),
    hardwarePointName: formData.get("hardwarePointName") || undefined,
    notes: formData.get("notes") || undefined,
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const owns = await client.query(
      `SELECT 1 FROM crm.bookings
       WHERE id = $1::uuid AND occurrence_id = $2::uuid`,
      [input.bookingId, input.occurrenceId],
    );
    if (!owns.rowCount) throw new Error("Booking occurrence not found.");
    if (input.pointId) {
      const changed = await client.query(
        `UPDATE crm.course_points SET name = $3, hardware_point_name = $4,
          notes = $5, updated_at = now()
         WHERE id = $2::uuid AND occurrence_id = $1::uuid RETURNING id`,
        [input.occurrenceId, input.pointId, input.name,
          input.hardwarePointName ?? null, input.notes ?? null],
      );
      if (!changed.rowCount) throw new Error("Course point not found.");
    } else {
      await client.query(
        `INSERT INTO crm.course_points
          (occurrence_id, name, hardware_point_name, notes, sort_order)
         SELECT $1::uuid, $2, $3, $4, COALESCE(MAX(sort_order), -1) + 1
         FROM crm.course_points WHERE occurrence_id = $1::uuid`,
        [input.occurrenceId, input.name, input.hardwarePointName ?? null,
          input.notes ?? null],
      );
    }
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      input.pointId ? `Course point updated: ${input.name}` :
        `Course point added: ${input.name}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(input.bookingId);
}

export async function deleteCoursePointAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const occurrenceId = uuid.parse(formData.get("occurrenceId"));
  const pointId = uuid.parse(formData.get("pointId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query<{ name: string }>(
      `DELETE FROM crm.course_points point
       USING crm.bookings booking
       WHERE point.id = $3::uuid AND point.occurrence_id = $2::uuid
         AND booking.id = $1::uuid AND booking.occurrence_id = point.occurrence_id
       RETURNING point.name`,
      [bookingId, occurrenceId, pointId],
    );
    if (!removed.rows[0]) throw new Error("Course point not found.");
    await appendAuditActivity(client, { bookingId }, user,
      `Course point removed: ${removed.rows[0].name}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(bookingId);
}

export async function addCrewAssignmentAction(formData: FormData) {
  await requireOperator(formData);
  const input = z
    .object({
      bookingId: uuid,
      occurrenceId: uuid,
      personId: uuid.optional(),
      freeformName: optionalText(300),
      role: optionalText(300),
      notes: optionalText(5_000),
    })
    .refine((value) => value.personId || value.freeformName, {
      message: "Choose a known person or enter a crew name.",
    })
    .parse({
      bookingId: formData.get("bookingId"),
      occurrenceId: formData.get("occurrenceId"),
      personId: formData.get("personId") || undefined,
      freeformName: formData.get("freeformName") || undefined,
      role: formData.get("role") || undefined,
      notes: formData.get("notes") || undefined,
    });
  const inserted = await getPool().query(
    `
      INSERT INTO crm.crew_assignments
        (occurrence_id, person_id, freeform_name, role, notes)
      SELECT $2::uuid, $3::uuid, $4, $5, $6
      FROM crm.bookings booking
      LEFT JOIN crm.people person ON person.id = $3::uuid
      WHERE booking.id = $1::uuid AND booking.occurrence_id = $2::uuid
        AND (
          (
            $3::uuid IS NOT NULL
            AND person.id IS NOT NULL
            AND person.is_active = true
            AND person.archived_at IS NULL
            AND ${personTaggedToClientOrgSql("booking.direct_client_organization_id")}
          )
          OR (
            $3::uuid IS NULL
            AND NULLIF(trim(COALESCE($4, '')), '') IS NOT NULL
          )
        )
      RETURNING id
    `,
    [
      input.bookingId,
      input.occurrenceId,
      input.personId ?? null,
      input.freeformName ?? null,
      input.role ?? null,
      input.notes ?? null,
    ],
  );
  if (!inserted.rowCount) {
    throw new Error("Crew contact must be an active person tagged to this client.");
  }
  refreshBooking(input.bookingId);
}

export async function createCrewMemberAction(formData: FormData) {
  const { user, organizationId } = await requireOperator(formData);
  const input = z.object({
    bookingId: uuid,
    occurrenceId: uuid,
    displayName: z.string().trim().min(1).max(300),
    email: z.string().trim().email().max(300).optional(),
    phone: optionalText(100),
    role: optionalText(300),
  }).parse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    displayName: formData.get("displayName"),
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    role: formData.get("role") || undefined,
  });
  const displayName = resolvePersonDisplayName({ displayName: input.displayName });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const booking = await client.query<{ occurrence_id: string }>(
      `SELECT occurrence_id::text
       FROM crm.bookings
       WHERE id = $1::uuid AND occurrence_id = $2::uuid
         AND direct_client_organization_id = $3::uuid
       FOR UPDATE`,
      [input.bookingId, input.occurrenceId, organizationId],
    );
    if (!booking.rows[0]) throw new Error("Booking occurrence not found.");
    const person = await client.query<{ id: string }>(
      `
        INSERT INTO crm.people
          (organization_id, display_name, email, phone)
        VALUES ($1::uuid, $2, $3, $4)
        RETURNING id::text
      `,
      [organizationId, displayName, input.email ?? null, input.phone ?? null],
    );
    const personId = person.rows[0].id;
    await addPersonOrganization(client, personId, organizationId);
    await client.query(
      `
        INSERT INTO crm.crew_assignments
          (occurrence_id, person_id, role)
        VALUES ($1::uuid, $2::uuid, $3)
      `,
      [input.occurrenceId, personId, input.role ?? null],
    );
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      `Crew member added: ${displayName}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(input.bookingId);
  revalidatePath(`/contacts`);
}

export async function saveCrewAssignmentAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const input = z.object({
    bookingId: uuid,
    occurrenceId: uuid,
    assignmentId: uuid.optional(),
    personId: uuid.optional(),
    freeformName: optionalText(300),
    role: optionalText(300),
    notes: optionalText(5_000),
  }).refine((value) => value.personId || value.freeformName, {
    message: "Choose a known person or enter a crew name.",
  }).parse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    assignmentId: formData.get("assignmentId") || undefined,
    personId: formData.get("personId") || undefined,
    freeformName: formData.get("freeformName") || undefined,
    role: formData.get("role") || undefined,
    notes: formData.get("notes") || undefined,
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const owns = await client.query(
      `SELECT 1 FROM crm.bookings
       WHERE id = $1::uuid AND occurrence_id = $2::uuid`,
      [input.bookingId, input.occurrenceId],
    );
    if (!owns.rowCount) throw new Error("Booking occurrence not found.");
    if (input.assignmentId) {
      const changed = await client.query(
        `UPDATE crm.crew_assignments crew
         SET person_id = $3::uuid, freeform_name = $4, role = $5, notes = $6,
           updated_at = now()
         FROM crm.bookings booking
         LEFT JOIN crm.people person ON person.id = $3::uuid
         WHERE crew.id = $2::uuid AND crew.occurrence_id = $1::uuid
           AND booking.occurrence_id = crew.occurrence_id
           AND booking.id = $7::uuid
           AND (
             $3::uuid IS NULL
             OR (
               person.id IS NOT NULL
               AND (
                 (
                   person.is_active = true
                   AND person.archived_at IS NULL
                   AND ${personTaggedToClientOrgSql("booking.direct_client_organization_id")}
                 )
                 OR EXISTS (
                   SELECT 1 FROM crm.crew_assignments existing
                   WHERE existing.occurrence_id = crew.occurrence_id
                     AND existing.person_id = $3::uuid
                 )
               )
             )
           )
         RETURNING crew.id`,
        [input.occurrenceId, input.assignmentId, input.personId ?? null,
          input.freeformName ?? null, input.role ?? null, input.notes ?? null,
          input.bookingId],
      );
      if (!changed.rowCount) throw new Error("Crew assignment not found.");
    } else {
      await client.query(
        `INSERT INTO crm.crew_assignments
          (occurrence_id, person_id, freeform_name, role, notes)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
        [input.occurrenceId, input.personId ?? null, input.freeformName ?? null,
          input.role ?? null, input.notes ?? null],
      );
    }
    await appendAuditActivity(client, { bookingId: input.bookingId }, user,
      input.assignmentId ? "Crew assignment updated" : "Crew assignment added");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(input.bookingId);
}

export async function deleteCrewAssignmentAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const occurrenceId = uuid.parse(formData.get("occurrenceId"));
  const assignmentId = uuid.parse(formData.get("assignmentId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query(
      `DELETE FROM crm.crew_assignments crew
       USING crm.bookings booking
       WHERE crew.id = $3::uuid AND crew.occurrence_id = $2::uuid
         AND booking.id = $1::uuid AND booking.occurrence_id = crew.occurrence_id
       RETURNING crew.id`,
      [bookingId, occurrenceId, assignmentId],
    );
    if (!removed.rowCount) throw new Error("Crew assignment not found.");
    await appendAuditActivity(client, { bookingId }, user,
      "Crew assignment removed");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(bookingId);
}

export async function updatePrepItemDetailsAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const itemId = uuid.parse(formData.get("itemId"));
  const label = z.string().trim().min(1).max(300).parse(formData.get("label"));
  const notes = optionalText(5_000).parse(formData.get("notes") || undefined);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `UPDATE crm.booking_prep_items
       SET label = $3, notes = $4, updated_by_user_id = $5::uuid,
         updated_at = now()
       WHERE id = $2::uuid AND booking_id = $1::uuid RETURNING id`,
      [bookingId, itemId, label, notes ?? null, user.id],
    );
    if (!changed.rowCount) throw new Error("Prep item not found.");
    await appendAuditActivity(client, { bookingId }, user,
      `Prep item updated: ${label}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(bookingId);
}

export async function resyncBookingCatalogRacesAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const occurrenceId = uuid.parse(formData.get("occurrenceId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const booking = await client.query<{
      listing_id: string | null;
      event_id: string;
    }>(
      `
        SELECT event.catalog_race_listing_id AS listing_id,
               event.id::text AS event_id
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
        JOIN crm.events event ON event.id = occurrence.event_id
        WHERE booking.id = $1::uuid
          AND occurrence.id = $2::uuid
      `,
      [bookingId, occurrenceId],
    );
    if (!booking.rows[0]) throw new Error("Booking occurrence not found.");
    const result = await refreshOccurrenceFromOnlineListing(client, {
      eventId: booking.rows[0].event_id,
      occurrenceId,
    });
    await appendAuditActivity(
      client,
      { bookingId },
      user,
      result.inserted
        ? `Re-synced ${result.inserted} race${result.inserted === 1 ? "" : "s"} from the online listing`
        : "Re-synced races from the online listing",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(bookingId);
}

export async function updatePrepItemAction(formData: FormData) {
  const { user } = await requireOperator(formData);
  const bookingId = uuid.parse(formData.get("bookingId"));
  const itemId = uuid.parse(formData.get("itemId"));
  const status = z
    .enum(["pending", "complete", "not_applicable"])
    .parse(formData.get("status"));
  await getPool().query(
    `
      UPDATE crm.booking_prep_items
      SET status = $3::crm.prep_item_status, updated_by_user_id = $4::uuid,
          updated_at = now()
      WHERE id = $2::uuid AND booking_id = $1::uuid
    `,
    [bookingId, itemId, status, user.id],
  );
  refreshBooking(bookingId);
}
