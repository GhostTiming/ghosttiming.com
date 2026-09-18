import type { PoolClient } from "pg";
import {
  parseClosedLostDetails,
  parseDisqualifiedDetails,
  parseUnqualifiedDetails,
  shouldCloseProspect,
  shouldMarkDoNotContact,
  type ClosedLostDetails,
  type UserActivityType,
} from "./domain";
import { eventMatchKey, isGenericEventName } from "./event-matching";
import { cancelOpenProspectTasks, PAST_EVENT_STAGE_KEY } from "./past-events";

export type RecordActivityInput = {
  prospectId?: string;
  bookingId?: string;
  type: UserActivityType;
  body: string;
  disposition?: string;
  occurredAt?: Date;
  actorType: "human" | "ai" | "system";
  actorUserId?: string;
  actorName: string;
  metadata?: Record<string, unknown>;
  followUp?: {
    title: string;
    dueAt: Date;
    assignedUserId: string;
  };
};

export async function insertActivityAndFollowUp(
  client: PoolClient,
  input: RecordActivityInput,
) {
  if (!input.prospectId && !input.bookingId) {
    throw new Error("Activity needs a prospect or booking.");
  }
  const activity = await client.query<{ id: string }>(
    `
      INSERT INTO crm.activities
        (
          prospect_id,
          booking_id,
          type,
          body,
          disposition,
          occurred_at,
          actor_type,
          actor_user_id,
          actor_name,
          metadata
        )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::crm.activity_type,
        $4,
        $5,
        COALESCE($6::timestamptz, now()),
        $7::crm.actor_type,
        $8::uuid,
        $9,
        $10::jsonb
      )
      RETURNING id::text
    `,
    [
      input.prospectId ?? null,
      input.bookingId ?? null,
      input.type,
      input.body,
      input.disposition ?? null,
      input.occurredAt ?? null,
      input.actorType,
      input.actorUserId ?? null,
      input.actorName,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  let taskId: string | undefined;
  if (input.followUp) {
    const task = await client.query<{ id: string }>(
      `
        INSERT INTO crm.tasks
          (prospect_id, booking_id, source_activity_id, assigned_user_id, title, due_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)
        RETURNING id::text
      `,
      [
        input.prospectId ?? null,
        input.bookingId ?? null,
        activity.rows[0].id,
        input.followUp.assignedUserId,
        input.followUp.title,
        input.followUp.dueAt,
      ],
    );
    taskId = task.rows[0].id;
  }

  return { activityId: activity.rows[0].id, taskId };
}

export async function applyTerminalDisposition(
  client: PoolClient,
  prospectId: string,
  disposition: string | undefined,
) {
  if (!shouldCloseProspect(disposition)) return false;

  const stageChange = await client.query<{
    old_name: string;
    changed: boolean;
  }>(
    `
      WITH current_state AS (
        SELECT p.stage_id, old_stage.name AS old_name
        FROM crm.prospects p
        JOIN crm.pipeline_stages old_stage ON old_stage.id = p.stage_id
        WHERE p.id = $1::uuid
      ),
      closed_stage AS (
        SELECT id FROM crm.pipeline_stages
        WHERE pipeline = 'prospect' AND key = 'closed_lost'
      ),
      changed AS (
        UPDATE crm.prospects
        SET stage_id = closed_stage.id,
            closed_at = COALESCE(closed_at, now()),
            do_not_contact = do_not_contact OR $2::boolean,
            updated_at = now()
        FROM closed_stage, current_state
        WHERE prospects.id = $1::uuid
        RETURNING prospects.stage_id <> current_state.stage_id AS changed
      )
      SELECT current_state.old_name, changed.changed
      FROM current_state, changed
    `,
    [prospectId, shouldMarkDoNotContact(disposition)],
  );
  if (stageChange.rows[0]?.changed) {
    await client.query(
      `
        INSERT INTO crm.activities
          (prospect_id, type, body, actor_type, actor_name, metadata)
        VALUES (
          $1::uuid,
          'stage_change',
          $2,
          'system',
          'System',
          jsonb_build_object('reason', 'terminal_disposition')
        )
      `,
      [
        prospectId,
        `Stage changed from ${stageChange.rows[0].old_name} to Closed Lost`,
      ],
    );
  }
  return true;
}

export type StageChangeActor = {
  actorType: "human" | "ai" | "system";
  actorName: string;
  actorUserId?: string;
};

export async function changeProspectStage(
  client: PoolClient,
  prospectId: string,
  stageKey: string,
  actor: StageChangeActor,
  closedLost?: Parameters<typeof parseClosedLostDetails>[0] | ClosedLostDetails | null,
  outcome?: {
    unqualified?: { reason?: string | null; note?: string | null } | null;
    disqualified?: { reason?: string | null; note?: string | null } | null;
  } | null,
) {
  const current = await client.query<{ key: string }>(
    `
      SELECT stage.key
      FROM crm.prospects prospect
      JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
      WHERE prospect.id = $1::uuid
      FOR UPDATE
    `,
    [prospectId],
  );
  if (!current.rows[0]) throw new Error("Prospect not found.");
  if (current.rows[0].key === stageKey) return false;

  const closedLostDetails =
    stageKey === "closed_lost" ? parseClosedLostDetails(closedLost ?? {}) : null;
  const unqualifiedDetails =
    stageKey === "unqualified"
      ? parseUnqualifiedDetails(outcome?.unqualified ?? {})
      : null;
  const disqualifiedDetails =
    stageKey === "disqualified"
      ? parseDisqualifiedDetails(outcome?.disqualified ?? {})
      : null;
  const changed = await client.query<{ old_name: string; new_name: string }>(
    `
      WITH target_stage AS (
        SELECT id, key, name
        FROM crm.pipeline_stages
        WHERE key = $2 AND pipeline = 'prospect' AND is_active = true
      ),
      current_state AS (
        SELECT p.stage_id, current_stage.name AS old_name
        FROM crm.prospects p
        JOIN crm.pipeline_stages current_stage ON current_stage.id = p.stage_id
        WHERE p.id = $1::uuid
      ),
      updated AS (
        UPDATE crm.prospects
        SET stage_id = target_stage.id,
            closed_at = CASE
              WHEN target_stage.key IN ('closed_lost', 'disqualified', 'unqualified', 'past_event')
                THEN COALESCE(closed_at, now())
              ELSE NULL
            END,
            closed_lost_reason = CASE
              WHEN target_stage.key = 'closed_lost' THEN $3
              ELSE closed_lost_reason
            END,
            closed_lost_note = CASE
              WHEN target_stage.key = 'closed_lost' THEN $4
              ELSE closed_lost_note
            END,
            circle_back_on = CASE
              WHEN target_stage.key = 'closed_lost' THEN $5::date
              ELSE circle_back_on
            END,
            unqualified_reason = CASE
              WHEN target_stage.key = 'unqualified' THEN $6
              ELSE unqualified_reason
            END,
            unqualified_note = CASE
              WHEN target_stage.key = 'unqualified' THEN $7
              ELSE unqualified_note
            END,
            disqualified_reason = CASE
              WHEN target_stage.key = 'disqualified' THEN $8
              ELSE disqualified_reason
            END,
            disqualified_note = CASE
              WHEN target_stage.key = 'disqualified' THEN $9
              ELSE disqualified_note
            END,
            do_not_contact = CASE
              WHEN target_stage.key = 'disqualified' AND $8 = 'do_not_contact' THEN true
              ELSE do_not_contact
            END,
            updated_at = now()
        FROM target_stage, current_state
        WHERE prospects.id = $1::uuid
          AND prospects.stage_id <> target_stage.id
        RETURNING current_state.old_name, target_stage.name AS new_name
      )
      SELECT old_name, new_name FROM updated
    `,
    [
      prospectId,
      stageKey,
      closedLostDetails?.reason ?? null,
      closedLostDetails?.note ?? null,
      closedLostDetails?.circleBackOn ?? null,
      unqualifiedDetails?.reason ?? null,
      unqualifiedDetails?.note ?? null,
      disqualifiedDetails?.reason ?? null,
      disqualifiedDetails?.note ?? null,
    ],
  );
  if (!changed.rows[0]) return false;

  const reasonLabel =
    closedLostDetails?.reason ??
    unqualifiedDetails?.reason ??
    disqualifiedDetails?.reason;
  const activityBody = reasonLabel
    ? `Stage changed from ${changed.rows[0].old_name} to ${changed.rows[0].new_name} (${reasonLabel})`
    : `Stage changed from ${changed.rows[0].old_name} to ${changed.rows[0].new_name}`;

  await client.query(
    `
      INSERT INTO crm.activities
        (prospect_id, type, body, actor_type, actor_user_id, actor_name)
      VALUES ($1::uuid, 'stage_change', $2, $3::crm.actor_type, $4::uuid, $5)
    `,
    [
      prospectId,
      activityBody,
      actor.actorType,
      actor.actorUserId ?? null,
      actor.actorName,
    ],
  );
  if (stageKey === PAST_EVENT_STAGE_KEY) {
    await cancelOpenProspectTasks(client, [prospectId]);
  }
  return true;
}

export async function findOrCreateStandingEvent(
  client: PoolClient,
  input: {
    name: string;
    ownerOrganizationId?: string | null;
    website?: string | null;
    notes?: string | null;
    sourceType?: string;
  },
) {
  const key = eventMatchKey(input.name);
  if (key && !isGenericEventName(input.name)) {
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.events WHERE archived_at IS NULL`,
    );
    const match = existing.rows.find((row) => eventMatchKey(row.name) === key);
    if (match) {
      await client.query(
        `UPDATE crm.events SET
           default_owner_organization_id =
             COALESCE(default_owner_organization_id, $2::uuid),
           website = COALESCE(website, $3),
           notes = COALESCE(notes, $4),
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          match.id,
          input.ownerOrganizationId ?? null,
          input.website ?? null,
          input.notes ?? null,
        ],
      );
      return match.id;
    }
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO crm.events
      (name, source_type, default_owner_organization_id, website, notes)
     VALUES ($1, $2, $3::uuid, $4, $5)
     RETURNING id::text`,
    [
      input.name,
      input.sourceType ?? "manual",
      input.ownerOrganizationId ?? null,
      input.website ?? null,
      input.notes ?? null,
    ],
  );
  return created.rows[0].id;
}

export async function startProspectFromListing(
  client: PoolClient,
  input: { raceListingId: string; userId: string },
) {
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
    [input.raceListingId, input.userId],
  );
  const prospectId = result.rows[0]?.id;
  if (!prospectId) throw new Error("Could not start this lead.");

  const linked = await client.query<{ event_id: string | null }>(
    `SELECT event_id::text FROM crm.prospects WHERE id = $1::uuid`,
    [prospectId],
  );
  if (!linked.rows[0]?.event_id) {
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
        inserted_event AS (
          INSERT INTO crm.events
            (name, catalog_race_listing_id, source_type, website)
          SELECT name, $1, 'other', registration_url FROM source
          RETURNING id
        ),
        inserted_occurrence AS (
          INSERT INTO crm.event_occurrences
            (event_id, catalog_race_edition_id, occurrence_year, race_date,
             timezone, registration_url_override, street_override,
             street2_override, city_override, state_override, zipcode_override)
          SELECT event.id, source.race_edition_id, source.occurrence_year,
            source.race_date, source.timezone, source.registration_url,
            source.street, source.street2, source.city, source.state,
            source.zipcode
          FROM source CROSS JOIN inserted_event event
          RETURNING id, event_id
        )
        UPDATE crm.prospects
        SET event_id = occurrence.event_id, occurrence_id = occurrence.id,
          updated_at = now()
        FROM inserted_occurrence occurrence
        WHERE prospects.id = $2::uuid
      `,
      [input.raceListingId, prospectId],
    );
  }

  await client.query(
    `
      UPDATE crm.contact_methods
      SET prospect_id = $2::uuid, updated_at = now()
      WHERE race_listing_id = $1 AND prospect_id IS NULL
    `,
    [input.raceListingId, prospectId],
  );
  return prospectId;
}

export async function closeCandidateListing(
  client: PoolClient,
  input: {
    raceListingId: string;
    userId: string;
    userName: string;
    stageKey: "disqualified" | "unqualified";
    reason?: string | null;
    note?: string | null;
    actorType?: StageChangeActor["actorType"];
    actorName?: string;
  },
) {
  const prospectId = await startProspectFromListing(client, {
    raceListingId: input.raceListingId,
    userId: input.userId,
  });
  const changed = await changeProspectStage(
    client,
    prospectId,
    input.stageKey,
    {
      actorType: input.actorType ?? "human",
      actorUserId: input.userId,
      actorName: input.actorName ?? input.userName,
    },
    null,
    {
      unqualified:
        input.stageKey === "unqualified"
          ? { reason: input.reason, note: input.note }
          : null,
      disqualified:
        input.stageKey === "disqualified"
          ? { reason: input.reason, note: input.note }
          : null,
    },
  );
  return changed;
}
