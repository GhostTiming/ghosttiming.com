import "server-only";

import { getPool } from "@/db";
import { closedProspectStageKeys } from "./domain";
import {
  parsePerkFilterParams,
  perkFilterTagSql,
} from "./catalog-display";
import {
  candidateHasUsableContactSql,
  listingHasGrvContactFlagSql,
  liveBookingOwnsEventSql,
  liveBookingOwnsListingSql,
  reconcileProspectCatalogMatches,
} from "./catalog-link";
import { applyEmailBlacklist } from "./email-blacklist";
import {
  effectiveProspectStageKeySql,
  effectiveProspectStageNameSql,
  filePastProspects,
} from "./past-events";
import {
  offeringsMatchingOccurrenceDate,
  preferredCatalogEditionSql,
} from "./race-operations";
import { geocodeUsZip, normalizeZip } from "./geo";

const closedProspectStageSql = closedProspectStageKeys
  .map((key) => `'${key}'`)
  .join(", ");

export type ProspectListRow = {
  race_listing_id: string | null;
  prospect_id: string | null;
  race_name: string;
  logo_url: string | null;
  event_date: string | null;
  location: string;
  stage_key: string;
  stage_name: string;
  touch_count: number;
  last_touch_at: string | null;
  last_disposition: string | null;
  next_step: string | null;
  next_step_at: string | null;
  owner_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  contact_processed: boolean;
};

export type ProspectListResult = {
  rows: ProspectListRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type ProspectListOptions = {
  page?: number;
  pageSize?: number;
  view?: string;
  phone?: "all" | "has" | "missing";
  email?: "all" | "has" | "missing";
  touches?: number | null;
  search?: string | null;
  eventFrom?: string | null;
  eventTo?: string | null;
  state?: string | null;
  city?: string | null;
  zip?: string | null;
  miles?: number | null;
  hasPerk?: string | null;
  missingPerk?: string | null;
  sort?: string;
  direction?: "asc" | "desc";
};

export async function listProspects(
  options: ProspectListOptions = {},
): Promise<ProspectListResult> {
  const safePage = Math.max(1, Math.floor(options.page ?? 1));
  const safePageSize = Math.min(
    100,
    Math.max(1, Math.floor(options.pageSize ?? 25)),
  );
  const offset = (safePage - 1) * safePageSize;
  const viewAliases: Record<string, string> = {
    contacting: "cold",
    interested: "cold",
  };
  const validViews = new Set([
    "active",
    "all",
    "archived",
    "candidate",
    "cold",
    "contacting",
    "interested",
    "scoping",
    "confirmed",
    "closed_lost",
    "disqualified",
    "unqualified",
    "past_event",
  ]);
  const requestedView = options.view ?? "";
  const view = validViews.has(requestedView)
    ? (viewAliases[requestedView] ?? requestedView)
    : "active";
  const sortExpressions: Record<string, string> = {
    priority: `CASE stage_key
      WHEN 'candidate' THEN 0 WHEN 'cold' THEN 1 WHEN 'scoping' THEN 2
      WHEN 'confirmed' THEN 3 WHEN 'closed_lost' THEN 4
      WHEN 'disqualified' THEN 5 WHEN 'unqualified' THEN 6
      WHEN 'past_event' THEN 7 ELSE 8 END`,
    race: "lower(race_name)",
    event_date: "sort_date",
    stage: "lower(stage_name)",
    phone: "(primary_phone IS NULL)",
    email: "(primary_email IS NULL)",
    touches: "touch_count",
    last_touch: "last_touch_at::timestamptz",
    next_step: "next_step_at::timestamptz",
    owner: "lower(owner_name)",
  };
  const sort = sortExpressions[options.sort ?? ""] ? options.sort! : "priority";
  const direction = options.direction === "desc" ? "DESC" : "ASC";
  const touchCount =
    options.touches !== null &&
    options.touches !== undefined &&
    Number.isInteger(options.touches) &&
    options.touches >= 0
      ? options.touches
      : null;
  const state = options.state?.trim().toUpperCase() || null;
  const city = options.city?.trim() || null;
  const zip = normalizeZip(options.zip) || null;
  const miles =
    options.miles !== null &&
    options.miles !== undefined &&
    Number.isFinite(options.miles) &&
    options.miles > 0
      ? options.miles
      : null;
  const origin =
    zip && miles ? await geocodeUsZip(zip) : null;
  const perks = parsePerkFilterParams({
    hasPerk: options.hasPerk,
    missingPerk: options.missingPerk,
  });
  const result = await getPool().query<ProspectListRow & { total_count: number }>(
    `
      WITH visible_listings AS (
        SELECT p.race_listing_id AS id
        FROM crm.prospects p
        WHERE p.race_listing_id IS NOT NULL
          AND $3::text <> 'candidate'
        UNION
        SELECT rl.id
        FROM catalog.race_listings rl
        WHERE $3::text IN ('candidate', 'all')
          AND NOT ${liveBookingOwnsListingSql("rl.id")}
          AND rl.next_start_at >= now()
          AND ${listingHasGrvContactFlagSql("rl.id")}
          AND NOT EXISTS (
            SELECT 1
            FROM crm.events linked_event
            JOIN crm.prospects linked_prospect
              ON linked_prospect.event_id = linked_event.id
             AND linked_prospect.archived_at IS NULL
            WHERE linked_event.catalog_race_listing_id = rl.id
          )
      ),
      catalog_rows AS (
        SELECT
          rl.id AS race_listing_id,
          p.id::text AS prospect_id,
          COALESCE(event.name, rl.name) AS race_name,
          rl.logo_url,
          COALESCE(
            occurrence.race_date::text,
            to_char(edition.starts_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
            to_char(rl.next_start_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
          ) AS event_date,
          concat_ws(', ',
            NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), rl.city), ''),
            NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), rl.state), '')
          ) AS location,
          NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), rl.city), '') AS city,
          NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), rl.state), '') AS state,
          NULLIF(COALESCE(NULLIF(occurrence.zipcode_override, ''), rl.zipcode), '') AS zipcode,
          rl.latitude,
          rl.longitude,
          ${effectiveProspectStageKeySql(
            "COALESCE(queue.stage_key, 'candidate')",
            "COALESCE(occurrence.race_date, edition.starts_at, rl.next_start_at)",
          )} AS stage_key,
          ${effectiveProspectStageNameSql(
            "COALESCE(queue.stage_key, 'candidate')",
            "COALESCE(queue.stage_name, 'Candidate')",
            "COALESCE(occurrence.race_date, edition.starts_at, rl.next_start_at)",
          )} AS stage_name,
          COALESCE(queue.touch_count, 0)::integer AS touch_count,
          queue.last_touch_at::text,
          queue.last_disposition,
          queue.next_step,
          queue.next_step_at::text,
          owner.name AS owner_name,
          COALESCE(primary_person.email, email.normalized_value) AS primary_email,
          COALESCE(primary_person.phone, phone.raw_value) AS primary_phone,
          EXISTS (
            SELECT 1
            FROM crm.contact_extraction_state extraction
            WHERE extraction.race_listing_id = rl.id
              AND extraction.status = 'processed'
          ) AS contact_processed,
          queue.closed_at IS NOT NULL AS is_closed,
          p.archived_at IS NOT NULL AS is_archived,
          CASE WHEN p.id IS NULL THEN 1 ELSE 0 END AS sort_group,
          COALESCE(occurrence.race_date, edition.starts_at, rl.next_start_at)
            AS sort_date
        FROM visible_listings visible
        JOIN catalog.race_listings rl ON rl.id = visible.id
        LEFT JOIN LATERAL (
          SELECT re.id, re.starts_at
          FROM catalog.race_editions re
          WHERE re.race_listing_id = rl.id AND re.is_future = true
          ORDER BY re.starts_at ASC NULLS LAST
          LIMIT 1
        ) edition ON true
        LEFT JOIN crm.prospects p
          ON p.race_listing_id = rl.id
          AND p.race_edition_id IS NOT DISTINCT FROM edition.id
        LEFT JOIN crm.events event ON event.id = p.event_id
        LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = p.occurrence_id
        LEFT JOIN crm.prospect_work_queue queue ON queue.prospect_id = p.id
        LEFT JOIN crm.users owner ON owner.id = queue.assigned_user_id
        LEFT JOIN crm.people primary_person
          ON primary_person.id = p.primary_contact_person_id
        LEFT JOIN LATERAL (
          SELECT cm.normalized_value
          FROM crm.contact_methods cm
          WHERE (cm.prospect_id = p.id OR
            (cm.prospect_id IS NULL AND cm.race_listing_id = rl.id))
            AND cm.type = 'email' AND cm.status <> 'invalid'
          ORDER BY cm.is_primary DESC, cm.created_at ASC
          LIMIT 1
        ) email ON true
        LEFT JOIN LATERAL (
          SELECT cm.raw_value
          FROM crm.contact_methods cm
          WHERE (cm.prospect_id = p.id OR
            (cm.prospect_id IS NULL AND cm.race_listing_id = rl.id))
            AND cm.type = 'phone' AND cm.status <> 'invalid'
          ORDER BY cm.is_primary DESC, cm.created_at ASC
          LIMIT 1
        ) phone ON true
      ),
      imported_rows AS (
        SELECT
          NULL::text AS race_listing_id,
          prospect.id::text AS prospect_id,
          event.name AS race_name,
          listing.logo_url,
          occurrence.race_date::text AS event_date,
          concat_ws(', ',
            NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), listing.city), ''),
            NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), listing.state), '')
          ) AS location,
          NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), listing.city), '') AS city,
          NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), listing.state), '') AS state,
          NULLIF(COALESCE(NULLIF(occurrence.zipcode_override, ''), listing.zipcode), '') AS zipcode,
          listing.latitude,
          listing.longitude,
          ${effectiveProspectStageKeySql("queue.stage_key", "occurrence.race_date")} AS stage_key,
          ${effectiveProspectStageNameSql(
            "queue.stage_key",
            "queue.stage_name",
            "occurrence.race_date",
          )} AS stage_name,
          queue.touch_count,
          queue.last_touch_at::text,
          queue.last_disposition,
          queue.next_step,
          queue.next_step_at::text,
          owner.name AS owner_name,
          primary_person.email AS primary_email,
          primary_person.phone AS primary_phone,
          true AS contact_processed,
          queue.closed_at IS NOT NULL AS is_closed,
          prospect.archived_at IS NOT NULL AS is_archived,
          0 AS sort_group,
          occurrence.race_date AS sort_date
        FROM crm.prospects prospect
        JOIN crm.events event ON event.id = prospect.event_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = event.catalog_race_listing_id
        LEFT JOIN crm.event_occurrences occurrence
          ON occurrence.id = prospect.occurrence_id
        JOIN crm.prospect_work_queue queue ON queue.prospect_id = prospect.id
        LEFT JOIN crm.users owner ON owner.id = queue.assigned_user_id
        LEFT JOIN crm.people primary_person
          ON primary_person.id = prospect.primary_contact_person_id
        WHERE prospect.race_listing_id IS NULL
          AND NOT ${liveBookingOwnsListingSql("event.catalog_race_listing_id")}
          AND NOT ${liveBookingOwnsEventSql("event.id")}
      ),
      combined AS (
        SELECT * FROM catalog_rows
        UNION ALL
        SELECT * FROM imported_rows
      ),
      filtered AS (
        SELECT *
        FROM combined
        WHERE (
          ($3::text = 'archived' AND is_archived)
          OR (NOT is_archived AND (
          $3::text = 'all'
          OR ($3::text = 'active' AND prospect_id IS NOT NULL
            AND NOT is_closed AND stage_key NOT IN (${closedProspectStageSql}))
          OR ($3::text = 'candidate' AND prospect_id IS NULL
            AND stage_key = 'candidate'
            AND ${listingHasGrvContactFlagSql("combined.race_listing_id")}
            AND ${candidateHasUsableContactSql(
              "primary_phone",
              "primary_email",
              "contact_processed",
            )})
          OR ($3::text <> 'candidate' AND stage_key = $3::text)
          ))
        )
        AND (
          $4::text = 'all'
          OR ($4::text = 'has' AND primary_phone IS NOT NULL)
          OR ($4::text = 'missing' AND primary_phone IS NULL)
        )
        AND (
          $5::text = 'all'
          OR ($5::text = 'has' AND primary_email IS NOT NULL)
          OR ($5::text = 'missing' AND primary_email IS NULL)
        )
        AND ($6::integer IS NULL OR touch_count = $6::integer)
        AND ($7::text IS NULL OR race_name ILIKE '%' || $7::text || '%')
        AND ($8::date IS NULL OR sort_date >=
          $8::date::timestamp AT TIME ZONE 'America/New_York')
        AND ($9::date IS NULL OR sort_date <
          ($9::date + 1)::timestamp AT TIME ZONE 'America/New_York')
        AND ($10::text IS NULL OR state ILIKE $10::text)
        AND ($11::text IS NULL OR city ILIKE '%' || $11::text || '%')
        AND (
          (
            $15::double precision IS NULL
            AND ($12::text IS NULL OR zipcode LIKE $12::text || '%')
          )
          OR (
            $15::double precision IS NOT NULL
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
            AND 3958.8 * 2 * asin(sqrt(
              power(sin(radians(($13::double precision - latitude) / 2)), 2) +
              cos(radians($13::double precision)) * cos(radians(latitude)) *
              power(sin(radians(($14::double precision - longitude) / 2)), 2)
            )) <= $15::double precision
          )
        )
        AND (
          $16::text[] IS NULL
          OR (
            combined.race_listing_id IS NOT NULL
            AND (
              SELECT COUNT(*) FROM unnest($16::text[]) AS wanted(key)
              WHERE EXISTS (
                SELECT 1
                FROM catalog.race_listing_regex_tags tag
                WHERE tag.race_listing_id = combined.race_listing_id
                  AND tag.tag_namespace = 'perk'
                  AND tag.tag_value = 'true'
                  AND ${perkFilterTagSql("wanted.key")}
              )
            ) = cardinality($16::text[])
          )
        )
        AND (
          $17::text[] IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM unnest($17::text[]) AS wanted(key)
            JOIN catalog.race_listing_regex_tags tag
              ON tag.race_listing_id = combined.race_listing_id
             AND tag.tag_namespace = 'perk'
             AND tag.tag_value = 'true'
             AND ${perkFilterTagSql("wanted.key")}
          )
        )
      )
      SELECT
        filtered.*,
        count(*) OVER ()::integer AS total_count
      FROM filtered
      ORDER BY ${sortExpressions[sort]} ${direction} NULLS LAST,
        sort_date ASC NULLS LAST, race_name
      LIMIT $1 OFFSET $2
    `,
    [
      safePageSize,
      offset,
      view,
      options.phone ?? "all",
      options.email ?? "all",
      touchCount,
      options.search?.trim() || null,
      options.eventFrom || null,
      options.eventTo || null,
      state,
      city,
      origin ? null : zip,
      origin?.lat ?? null,
      origin?.lng ?? null,
      origin ? miles : null,
      perks.hasPerk.length ? perks.hasPerk : null,
      perks.missingPerk.length ? perks.missingPerk : null,
    ],
  );

  if (!result.rows.length && safePage > 1) {
    return listProspects({ ...options, page: 1 });
  }

  return {
    rows: result.rows,
    total: result.rows[0]?.total_count ?? 0,
    page: result.rows.length ? safePage : 1,
    pageSize: safePageSize,
  };
}

export type ProspectDetail = {
  id: string;
  archived_at: string | null;
  event_id: string;
  occurrence_id: string;
  race_listing_id: string | null;
  race_name: string;
  logo_url: string | null;
  event_date: string | null;
  event_date_local: string | null;
  timezone: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  location: string;
  registration_url: string | null;
  registration_url_override: string | null;
  street_override: string | null;
  street2_override: string | null;
  city_override: string | null;
  state_override: string | null;
  zipcode_override: string | null;
  legacy_note: string | null;
  legacy_status: string | null;
  stage_key: string;
  stage_name: string;
  owner_name: string | null;
  assigned_user_id: string | null;
  primary_contact_person_id: string | null;
  touch_count: number;
  last_step: string | null;
  last_step_at: string | null;
  last_step_note: string | null;
  next_step: string | null;
  next_step_at: string | null;
  next_step_on: string | null;
  next_step_note: string | null;
  closed_lost_reason: string | null;
  closed_lost_note: string | null;
  circle_back_on: string | null;
  do_not_contact: boolean;
  converted_booking_id: string | null;
  catalog_race_listing_id: string | null;
  catalog_match_dismissed_at: string | null;
  catalog_slug: string | null;
  description_html: string | null;
  quick_take: string | null;
};

export type CatalogTagRow = {
  tag_namespace: "perk" | "vibe";
  tag_key: string;
};

export type CatalogOfferingRow = {
  name: string;
  distance_label: string | null;
  start_time_raw: string | null;
  starts_at: string | null;
};

export type ActivityRow = {
  id: string;
  type: string;
  occurred_at: string;
  occurred_local: string;
  body: string;
  disposition: string | null;
  actor_type: string;
  actor_name: string;
  metadata: {
    eventType?: string;
    taskId?: string;
    source?: string;
    gmailMessageId?: string;
    gmailThreadId?: string;
  } | null;
};

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string;
  status: "open" | "complete" | "canceled";
  assignee_name: string;
  assigned_user_id?: string;
  due_local?: string;
  calendar_sync_status?: string | null;
};

export type StageRow = { id: string; key: string; name: string };
export type ContactMethodRow = {
  id: string;
  type: "email" | "phone";
  raw_value: string;
  label: string | null;
  is_primary: boolean;
  status: string;
  editable: boolean;
};

export async function getProspectDetail(prospectId: string) {
  const pool = getPool();
  const [
    detail,
    activityResult,
    taskResult,
    stageResult,
    contactResult,
    tagResult,
    offeringResult,
  ] =
    await Promise.all([
    pool.query<ProspectDetail>(
      `
        SELECT
          p.id::text,
          p.archived_at::text,
          p.event_id::text,
          p.occurrence_id::text,
          p.race_listing_id,
          COALESCE(event.name, rl.name) AS race_name,
          rl.logo_url,
          COALESCE(
            occurrence.race_date::text,
            to_char(re.starts_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
            rl.next_start_at::text
          ) AS event_date,
          to_char(COALESCE(occurrence.race_date, re.starts_at, rl.next_start_at)
            AT TIME ZONE COALESCE(occurrence.timezone, re.timezone, rl.timezone,
              'America/New_York'), 'YYYY-MM-DD"T"HH24:MI') AS event_date_local,
          COALESCE(occurrence.timezone, re.timezone, rl.timezone) AS timezone,
          COALESCE(NULLIF(occurrence.street_override, ''), rl.street) AS street,
          COALESCE(NULLIF(occurrence.street2_override, ''), rl.street2) AS street2,
          COALESCE(NULLIF(occurrence.city_override, ''), rl.city) AS city,
          COALESCE(NULLIF(occurrence.state_override, ''), rl.state) AS state,
          COALESCE(NULLIF(occurrence.zipcode_override, ''), rl.zipcode) AS zipcode,
          occurrence.street_override,
          occurrence.street2_override,
          occurrence.city_override,
          occurrence.state_override,
          occurrence.zipcode_override,
          concat_ws(', ',
            NULLIF(COALESCE(NULLIF(occurrence.street_override, ''), rl.street), ''),
            NULLIF(COALESCE(NULLIF(occurrence.street2_override, ''), rl.street2), ''),
            NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), rl.city), ''),
            NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), rl.state), ''),
            NULLIF(COALESCE(NULLIF(occurrence.zipcode_override, ''), rl.zipcode), '')
          ) AS location,
          COALESCE(
            NULLIF(occurrence.registration_url_override, ''),
            event.website,
            rl.registration_url,
            rl.external_race_url
          ) AS registration_url,
          occurrence.registration_url_override,
          notes.body AS legacy_note,
          notes.qualification_status AS legacy_status,
          queue.stage_key,
          queue.stage_name,
          owner.name AS owner_name,
          p.assigned_user_id::text,
          p.primary_contact_person_id::text,
          queue.touch_count,
          queue.last_step,
          queue.last_step_at::text,
          p.last_step_note,
          queue.next_step,
          queue.next_step_at::text,
          p.next_step_on::text,
          p.next_step_note,
          p.closed_lost_reason,
          p.closed_lost_note,
          p.circle_back_on::text,
          queue.do_not_contact,
          p.converted_booking_id::text,
          event.catalog_race_listing_id,
          event.catalog_match_dismissed_at::text,
          rl.slug AS catalog_slug,
          rl.description_html,
          enrich.quick_take
        FROM crm.prospects p
        LEFT JOIN crm.events event ON event.id = p.event_id
        LEFT JOIN catalog.race_listings rl
          ON rl.id = COALESCE(p.race_listing_id, event.catalog_race_listing_id)
        LEFT JOIN catalog.race_editions re ON re.id = p.race_edition_id
        LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = p.occurrence_id
        JOIN crm.prospect_work_queue queue ON queue.prospect_id = p.id
        LEFT JOIN crm.users owner ON owner.id = p.assigned_user_id
        LEFT JOIN catalog.lead_notes notes ON notes.race_listing_id = p.race_listing_id
        LEFT JOIN catalog.race_listing_ai_enrichment enrich
          ON enrich.race_listing_id = rl.id AND enrich.is_current = true
        WHERE p.id = $1::uuid
      `,
      [prospectId],
    ),
    pool.query<ActivityRow>(
      `
        SELECT id::text, type::text, occurred_at::text,
               to_char(occurred_at AT TIME ZONE 'America/New_York',
                 'YYYY-MM-DD"T"HH24:MI') AS occurred_local,
               body, disposition, actor_type::text, actor_name, metadata
        FROM crm.activities
        WHERE prospect_id = $1::uuid
        ORDER BY occurred_at DESC, created_at DESC
      `,
      [prospectId],
    ),
    pool.query<TaskRow>(
      `
        SELECT t.id::text, t.title, t.notes, t.due_at::text, t.status::text,
               u.name AS assignee_name, t.assigned_user_id::text,
               to_char(t.due_at AT TIME ZONE 'America/New_York',
                 'YYYY-MM-DD"T"HH24:MI') AS due_local,
               calendar_link.sync_status::text AS calendar_sync_status
        FROM crm.tasks t
        JOIN crm.users u ON u.id = t.assigned_user_id
        LEFT JOIN crm.google_task_calendar_links calendar_link
          ON calendar_link.task_id = t.id
        WHERE t.prospect_id = $1::uuid
        ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.due_at ASC
      `,
      [prospectId],
    ),
    pool.query<StageRow>(
      `
        SELECT id::text, key, name
        FROM crm.pipeline_stages
        WHERE pipeline = 'prospect' AND is_active = true
        ORDER BY sort_order
      `,
    ),
    pool.query<ContactMethodRow>(
      `
        SELECT * FROM (
          SELECT id::text, type::text, raw_value, label, is_primary, status::text,
                 true AS editable
          FROM crm.contact_methods
          WHERE prospect_id = $1::uuid
          UNION ALL
          SELECT person.id::text, 'email', person.email, 'Bigin primary contact',
                 true, 'unverified', false
          FROM crm.prospects prospect
          JOIN crm.people person ON person.id = prospect.primary_contact_person_id
          WHERE prospect.id = $1::uuid AND person.email IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM crm.contact_methods method
              WHERE method.prospect_id = prospect.id AND method.type = 'email'
                AND lower(method.normalized_value) = lower(person.email)
            )
          UNION ALL
          SELECT person.id::text, 'phone', person.phone, 'Bigin primary contact',
                 true, 'unverified', false
          FROM crm.prospects prospect
          JOIN crm.people person ON person.id = prospect.primary_contact_person_id
          WHERE prospect.id = $1::uuid AND person.phone IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM crm.contact_methods method
              WHERE method.prospect_id = prospect.id AND method.type = 'phone'
                AND method.normalized_value =
                  regexp_replace(person.phone, '[^0-9]', '', 'g')
            )
        ) contacts
        ORDER BY is_primary DESC, type
      `,
      [prospectId],
    ),
    pool.query<CatalogTagRow>(
      `
        SELECT tag.tag_namespace::text AS tag_namespace, tag.tag_key
        FROM crm.prospects p
        JOIN catalog.race_listings rl
          ON rl.id = COALESCE(p.race_listing_id, (
            SELECT event.catalog_race_listing_id
            FROM crm.events event
            WHERE event.id = p.event_id
          ))
        JOIN catalog.race_listing_regex_tags tag ON tag.race_listing_id = rl.id
        WHERE p.id = $1::uuid
          AND tag.tag_namespace IN ('perk', 'vibe')
          AND tag.tag_value = 'true'
        ORDER BY tag.tag_namespace, tag.tag_key
      `,
      [prospectId],
    ),
    pool.query<CatalogOfferingRow>(
      `
        SELECT
          offering.name,
          offering.distance_label,
          offering.start_time_raw,
          offering.starts_at::text
        FROM crm.prospects p
        JOIN catalog.race_listings rl
          ON rl.id = COALESCE(p.race_listing_id, (
            SELECT event.catalog_race_listing_id
            FROM crm.events event
            WHERE event.id = p.event_id
          ))
        LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = p.occurrence_id
        JOIN catalog.race_offerings offering
          ON offering.race_listing_id = rl.id
         AND offering.race_edition_id = COALESCE(
           p.race_edition_id,
           ${preferredCatalogEditionSql("rl.id")}
         )
        WHERE p.id = $1::uuid
          AND COALESCE(offering.is_merch_only, false) = false
          AND COALESCE(offering.is_volunteer, false) = false
        ORDER BY offering.starts_at NULLS LAST, offering.name
        LIMIT 20
      `,
      [prospectId],
    ),
    ]);

  return {
    prospect: detail.rows[0] ?? null,
    activities: activityResult.rows,
    tasks: taskResult.rows,
    stages: stageResult.rows,
    contactMethods: contactResult.rows,
    catalogTags: tagResult.rows,
    catalogOfferings: offeringResult.rows,
  };
}

export type TaskListRow = TaskRow & {
  race_name: string;
  prospect_id: string | null;
  booking_id: string | null;
  organization_id: string | null;
  calendar_sync_status: string | null;
};

export type CatalogOverviewListing = {
  id: string;
  name: string;
  catalog_slug: string | null;
  logo_url: string | null;
  description_html: string | null;
  quick_take: string | null;
  city: string | null;
  state: string | null;
  timezone: string | null;
  next_start_at?: string | null;
  location?: string | null;
};

export type CandidateListingDetail = {
  listing: CatalogOverviewListing;
  tags: CatalogTagRow[];
  offerings: CatalogOfferingRow[];
  contacts: Array<{ type: "email" | "phone"; raw_value: string }>;
  existingProspectId: string | null;
};

export async function getCandidateListing(listingId: string): Promise<CandidateListingDetail | null> {
  const overview = await getCatalogOverview(listingId);
  if (!overview.listing) return null;
  const pool = getPool();
  const [listing, contacts, existing] = await Promise.all([
    pool.query<CatalogOverviewListing>(
      `
        SELECT
          rl.id,
          rl.name,
          rl.slug AS catalog_slug,
          rl.logo_url,
          rl.description_html,
          enrich.quick_take,
          rl.city,
          rl.state,
          rl.timezone,
          rl.next_start_at::text,
          concat_ws(', ', NULLIF(rl.city, ''), NULLIF(rl.state, '')) AS location
        FROM catalog.race_listings rl
        LEFT JOIN catalog.race_listing_ai_enrichment enrich
          ON enrich.race_listing_id = rl.id AND enrich.is_current = true
        WHERE rl.id = $1
      `,
      [listingId],
    ),
    pool.query<{ type: "email" | "phone"; raw_value: string }>(
      `
        SELECT type::text, raw_value
        FROM crm.contact_methods
        WHERE race_listing_id = $1 AND prospect_id IS NULL AND status <> 'invalid'
        ORDER BY is_primary DESC, created_at ASC
      `,
      [listingId],
    ),
    pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM crm.prospects
        WHERE race_listing_id = $1 AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [listingId],
    ),
  ]);
  const row = listing.rows[0];
  if (!row) return null;
  return {
    listing: row,
    tags: overview.tags,
    offerings: overview.offerings,
    contacts: contacts.rows,
    existingProspectId: existing.rows[0]?.id ?? null,
  };
}

export async function getCatalogOverview(
  listingId: string,
  raceDate?: string | null,
) {
  const pool = getPool();
  const year = raceDate?.match(/^\d{4}/) ? Number(raceDate.slice(0, 4)) : null;
  const offeringParams = year == null ? [listingId] : [listingId, year];
  const [listing, tags, offerings] = await Promise.all([
    pool.query<CatalogOverviewListing>(
      `
        SELECT
          rl.id,
          rl.name,
          rl.slug AS catalog_slug,
          rl.logo_url,
          rl.description_html,
          enrich.quick_take,
          rl.city,
          rl.state,
          rl.timezone
        FROM catalog.race_listings rl
        LEFT JOIN catalog.race_listing_ai_enrichment enrich
          ON enrich.race_listing_id = rl.id AND enrich.is_current = true
        WHERE rl.id = $1
      `,
      [listingId],
    ),
    pool.query<CatalogTagRow>(
      `
        SELECT tag.tag_namespace::text AS tag_namespace, tag.tag_key
        FROM catalog.race_listing_regex_tags tag
        WHERE tag.race_listing_id = $1
          AND tag.tag_namespace IN ('perk', 'vibe')
          AND tag.tag_value = 'true'
        ORDER BY tag.tag_namespace, tag.tag_key
      `,
      [listingId],
    ),
    pool.query<CatalogOfferingRow>(
      `
        SELECT
          offering.name,
          offering.distance_label,
          offering.start_time_raw,
          offering.starts_at::text
        FROM catalog.race_offerings offering
        WHERE offering.race_listing_id = $1
          AND COALESCE(offering.is_merch_only, false) = false
          AND COALESCE(offering.is_volunteer, false) = false
          AND offering.race_edition_id = ${preferredCatalogEditionSql("$1", year == null ? null : "$2")}
        ORDER BY offering.starts_at NULLS LAST, offering.name
        LIMIT 20
      `,
      offeringParams,
    ),
  ]);

  return {
    listing: listing.rows[0] ?? null,
    tags: tags.rows,
    offerings: offeringsMatchingOccurrenceDate(offerings.rows, raceDate),
  };
}

export async function listTasks(options: {
  userId: string;
  showAll: boolean;
  organizationIds?: string[] | null;
}) {
  const result = await getPool().query<TaskListRow>(
    `
      SELECT
        t.id::text,
        t.title,
        t.notes,
        t.due_at::text,
        t.status::text,
        u.name AS assignee_name,
        COALESCE(rl.name, prospect_event.name, booking_event.name, organization.name)
          AS race_name,
        p.id::text AS prospect_id,
        booking.id::text AS booking_id,
        t.organization_id::text AS organization_id,
        calendar_link.sync_status::text AS calendar_sync_status
      FROM crm.tasks t
      JOIN crm.users u ON u.id = t.assigned_user_id
      LEFT JOIN crm.prospects p ON p.id = t.prospect_id
      LEFT JOIN catalog.race_listings rl ON rl.id = p.race_listing_id
      LEFT JOIN crm.events prospect_event ON prospect_event.id = p.event_id
      LEFT JOIN crm.bookings booking ON booking.id = t.booking_id
      LEFT JOIN crm.event_occurrences occurrence
        ON occurrence.id = booking.occurrence_id
      LEFT JOIN crm.events booking_event ON booking_event.id = occurrence.event_id
      LEFT JOIN crm.organizations organization ON organization.id = t.organization_id
      LEFT JOIN crm.google_task_calendar_links calendar_link
        ON calendar_link.task_id = t.id
      WHERE (
        $2::boolean
        OR t.assigned_user_id = $1::uuid
        OR (
          $3::uuid[] IS NOT NULL
          AND (
            t.organization_id = ANY($3::uuid[])
            OR booking.direct_client_organization_id = ANY($3::uuid[])
          )
        )
      )
      ORDER BY
        CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
        t.due_at ASC
      LIMIT 200
    `,
    [options.userId, options.showAll, options.organizationIds ?? null],
  );
  return result.rows;
}

export async function filePastProspectsWithPool() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await filePastProspects(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Filing past prospects failed", error);
    return null;
  } finally {
    client.release();
  }
}

const PROSPECTING_RECONCILE_TTL_MS = 120_000;
let lastProspectingReconcileAt = 0;

export async function reconcileProspectingWithPool(actor: {
  id: string;
  name: string;
}) {
  const skipCatalog =
    Date.now() - lastProspectingReconcileAt < PROSPECTING_RECONCILE_TTL_MS;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const past = await filePastProspects(client);
    const catalog = skipCatalog
      ? { linked: 0, archived: 0, considered: 0 }
      : await reconcileProspectCatalogMatches(client, actor);
    const blacklist = await applyEmailBlacklist(client, actor);
    await client.query("COMMIT");
    if (!skipCatalog) lastProspectingReconcileAt = Date.now();
    return { past, catalog, blacklist };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Prospecting reconcile failed", error);
    return null;
  } finally {
    client.release();
  }
}

