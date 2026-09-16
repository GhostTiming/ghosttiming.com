"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
  import {
  activityTypeFromEventType,
  dispositions,
  timelineEventTypes,
} from "@/lib/crm/domain";
import {
  applyTerminalDisposition,
  changeProspectStage,
  insertActivityAndFollowUp,
} from "@/lib/crm/mutations";

const uuid = z.string().uuid();

export async function startProspectAction(formData: FormData) {
  const user = await requireProspectingUser();
  const raceListingId = z.string().min(1).max(200).parse(formData.get("raceListingId"));
  const client = await getPool().connect();
  let prospectId: string;

  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(
      `
        WITH selected_edition AS (
          SELECT id
          FROM catalog.race_editions
          WHERE race_listing_id = $1 AND is_future = true
          ORDER BY starts_at ASC NULLS LAST
          LIMIT 1
        ),
        legacy_stage AS (
          SELECT COALESCE(
            CASE
              WHEN listing_dates.event_at IS NOT NULL
                AND (listing_dates.event_at AT TIME ZONE 'America/New_York')::date
                  < (now() AT TIME ZONE 'America/New_York')::date
                THEN 'past_event'
              WHEN notes.qualification_status ILIKE 'disqualified%' THEN 'disqualified'
              WHEN notes.qualification_status ILIKE 'unqualified%' THEN 'unqualified'
            END,
            'cold'
          ) AS key
          FROM (SELECT 1) AS dummy
          LEFT JOIN catalog.lead_notes notes ON notes.race_listing_id = $1
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              (
                SELECT re.starts_at
                FROM catalog.race_editions re
                WHERE re.race_listing_id = $1 AND re.is_future = true
                ORDER BY re.starts_at ASC NULLS LAST
                LIMIT 1
              ),
              listing.next_start_at
            ) AS event_at
            FROM catalog.race_listings listing
            WHERE listing.id = $1
          ) listing_dates ON true
        ),
        chosen_stage AS (
          SELECT stage.id, stage.key
          FROM crm.pipeline_stages stage
          JOIN legacy_stage ON stage.key = legacy_stage.key
          WHERE stage.pipeline = 'prospect' AND stage.is_active = true
        )
        INSERT INTO crm.prospects
          (race_listing_id, race_edition_id, assigned_user_id, stage_id, closed_at)
        SELECT $1, selected_edition.id, $2::uuid, chosen_stage.id,
          CASE WHEN chosen_stage.key IN ('disqualified', 'unqualified', 'closed_lost', 'past_event')
            THEN now() ELSE NULL END
        FROM chosen_stage
        LEFT JOIN selected_edition ON true
        ON CONFLICT (race_listing_id, (coalesce(race_edition_id, '')))
        DO UPDATE SET updated_at = now()
        RETURNING id::text
      `,
      [raceListingId, user.id],
    );
    prospectId = result.rows[0].id;
    await client.query(
      `
        WITH source AS (
          SELECT p.id, p.race_edition_id, listing.name,
            COALESCE(edition.starts_at, listing.next_start_at) AS race_date,
            COALESCE(edition.edition_year,
              EXTRACT(YEAR FROM listing.next_start_at)::integer) AS occurrence_year,
            COALESCE(edition.timezone, listing.timezone) AS timezone,
            COALESCE(listing.registration_url, listing.external_race_url)
              AS registration_url,
            listing.street, listing.street2, listing.city, listing.state,
            listing.zipcode
          FROM crm.prospects p
          JOIN catalog.race_listings listing ON listing.id = p.race_listing_id
          LEFT JOIN catalog.race_editions edition ON edition.id = p.race_edition_id
          WHERE p.id = $2::uuid
        ),
        upserted_event AS (
          INSERT INTO crm.events
            (name, catalog_race_listing_id, source_type, website)
          SELECT name, $1, 'other', registration_url FROM source
          ON CONFLICT (catalog_race_listing_id)
          DO UPDATE SET updated_at = now()
          RETURNING id
        ),
        upserted_occurrence AS (
          INSERT INTO crm.event_occurrences
            (event_id, catalog_race_edition_id, occurrence_year, race_date,
             timezone, registration_url_override, street_override,
             street2_override, city_override, state_override, zipcode_override)
          SELECT event.id, source.race_edition_id, source.occurrence_year,
            source.race_date, source.timezone, source.registration_url,
            source.street, source.street2, source.city, source.state,
            source.zipcode
          FROM source CROSS JOIN upserted_event event
          ON CONFLICT (catalog_race_edition_id)
          DO UPDATE SET
            street_override = COALESCE(event_occurrences.street_override, EXCLUDED.street_override),
            street2_override = COALESCE(event_occurrences.street2_override, EXCLUDED.street2_override),
            city_override = COALESCE(event_occurrences.city_override, EXCLUDED.city_override),
            state_override = COALESCE(event_occurrences.state_override, EXCLUDED.state_override),
            zipcode_override = COALESCE(event_occurrences.zipcode_override, EXCLUDED.zipcode_override),
            updated_at = now()
          RETURNING id, event_id
        )
        UPDATE crm.prospects
        SET event_id = occurrence.event_id, occurrence_id = occurrence.id,
          updated_at = now()
        FROM upserted_occurrence occurrence
        WHERE prospects.id = $2::uuid
      `,
      [raceListingId, prospectId],
    );
    await client.query(
      `
        UPDATE crm.contact_methods
        SET prospect_id = $2::uuid, updated_at = now()
        WHERE race_listing_id = $1 AND prospect_id IS NULL
      `,
      [raceListingId, prospectId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  redirect(`/prospecting/${prospectId}`);
}

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

export async function changeProspectStageAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const stageKey = z.string().min(1).max(80).parse(formData.get("stageKey"));
  const closedLost =
    stageKey === "closed_lost"
      ? {
          reason: String(formData.get("closedLostReason") ?? "") || null,
          note: String(formData.get("closedLostNote") ?? "") || null,
          circleBackOn: String(formData.get("circleBackOn") ?? "") || null,
        }
      : null;
  const outcome =
    stageKey === "unqualified" || stageKey === "disqualified"
      ? {
          unqualified:
            stageKey === "unqualified"
              ? {
                  reason: String(formData.get("outcomeReason") ?? "") || null,
                  note: String(formData.get("outcomeNote") ?? "") || null,
                }
              : null,
          disqualified:
            stageKey === "disqualified"
              ? {
                  reason: String(formData.get("outcomeReason") ?? "") || null,
                  note: String(formData.get("outcomeNote") ?? "") || null,
                }
              : null,
        }
      : null;
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await changeProspectStage(client, prospectId, stageKey, {
      actorType: "human",
      actorUserId: user.id,
      actorName: user.name,
    }, closedLost, outcome);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  revalidatePath(`/prospecting/${prospectId}`);
  revalidatePath("/prospecting");
}

export async function updateTaskStatusAction(formData: FormData) {
  const user = await requireProspectingUser();
  const taskId = uuid.parse(formData.get("taskId"));
  const status = z.enum(["open", "complete", "canceled"]).parse(formData.get("status"));
  await getPool().query(
    `
      UPDATE crm.tasks
      SET status = $2::crm.task_status,
          completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE NULL END,
          updated_at = now()
      WHERE id = $1::uuid
        AND (assigned_user_id = $3::uuid OR $4::boolean)
    `,
    [taskId, status, user.id, user.role === "admin"],
  );
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export async function signOutAction() {
  const { auth } = await import("@/lib/auth/neon");
  await auth.signOut();
  redirect("/auth/sign-in");
}
