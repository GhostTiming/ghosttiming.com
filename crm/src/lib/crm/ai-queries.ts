import "server-only";

import { getPool } from "@/db";

export type AiProspectFilters = {
  stage?: string;
  untouched?: boolean;
  includeClosed?: boolean;
  after?: string;
  limit: number;
};

export async function listAiProspects(filters: AiProspectFilters) {
  const stageKey =
    filters.stage === "contacting" || filters.stage === "interested"
      ? "cold"
      : filters.stage ?? null;
  const result = await getPool().query(
    `
      SELECT
        p.id::text AS lead_id,
        COALESCE(event.name, rl.name) AS race_name,
        COALESCE(
          occurrence.race_date::text,
          re.starts_at::text,
          rl.next_start_at::text
        ) AS occurrence_date,
        stage.key AS stage,
        owner.name AS assigned_owner,
        owner.id::text AS assigned_owner_id,
        queue.touch_count,
        queue.last_touch_at::text,
        queue.last_disposition,
        queue.last_step,
        queue.last_step_at::text,
        queue.next_step,
        queue.next_step_at::text,
        queue.do_not_contact,
        queue.closed_at::text,
        queue.converted_booking_id::text,
        COALESCE(contacts.items, primary_contacts.items, '[]'::jsonb)
          AS contact_methods
      FROM crm.prospects p
      JOIN crm.pipeline_stages stage ON stage.id = p.stage_id
      JOIN crm.prospect_work_queue queue ON queue.prospect_id = p.id
      LEFT JOIN crm.events event ON event.id = p.event_id
      LEFT JOIN catalog.race_listings rl
        ON rl.id = COALESCE(p.race_listing_id, event.catalog_race_listing_id)
      LEFT JOIN catalog.race_editions re ON re.id = p.race_edition_id
      LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = p.occurrence_id
      LEFT JOIN crm.users owner ON owner.id = p.assigned_user_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', cm.id,
            'type', cm.type,
            'value', cm.raw_value,
            'normalized_value', cm.normalized_value,
            'label', cm.label,
            'is_primary', cm.is_primary,
            'status', cm.status
          )
          ORDER BY cm.type, cm.is_primary DESC, cm.created_at
        ) AS items
        FROM crm.contact_methods cm
        WHERE (cm.prospect_id = p.id OR
          (cm.prospect_id IS NULL AND cm.race_listing_id = p.race_listing_id))
          AND cm.status <> 'invalid'
      ) contacts ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', person.id,
            'type', value.type,
            'value', value.value,
            'normalized_value', value.value,
            'label', 'Bigin primary contact',
            'is_primary', true,
            'status', 'unverified'
          )
        ) AS items
        FROM crm.people person
        CROSS JOIN LATERAL (
          VALUES ('email', person.email), ('phone', person.phone)
        ) value(type, value)
        WHERE person.id = p.primary_contact_person_id
          AND value.value IS NOT NULL
      ) primary_contacts ON true
      WHERE ($1::text IS NULL OR stage.key = $1)
        AND p.archived_at IS NULL
        AND ($2::boolean IS NULL OR (queue.touch_count = 0) = $2)
        AND ($3::boolean OR queue.closed_at IS NULL)
        AND ($4::uuid IS NULL OR p.id > $4::uuid)
      ORDER BY p.id
      LIMIT $5
    `,
    [
      stageKey,
      filters.untouched ?? null,
      filters.includeClosed ?? false,
      filters.after ?? null,
      filters.limit + 1,
    ],
  );
  const hasMore = result.rows.length > filters.limit;
  const rows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
  return {
    data: rows,
    next_cursor: hasMore ? rows.at(-1)?.lead_id ?? null : null,
  };
}

export async function getAiProspect(prospectId: string) {
  const prospectResult = await getPool().query(
    `
      SELECT
        p.id::text AS lead_id,
        p.race_listing_id,
        p.race_edition_id,
        COALESCE(event.name, rl.name) AS race_name,
        COALESCE(
          occurrence.race_date::text,
          re.starts_at::text,
          rl.next_start_at::text
        ) AS occurrence_date,
        COALESCE(occurrence.timezone, re.timezone, rl.timezone) AS timezone,
        concat_ws(', ',
          NULLIF(COALESCE(NULLIF(occurrence.street_override, ''), rl.street), ''),
          NULLIF(COALESCE(NULLIF(occurrence.street2_override, ''), rl.street2), ''),
          NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), rl.city), ''),
          NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), rl.state), ''),
          NULLIF(COALESCE(NULLIF(occurrence.zipcode_override, ''), rl.zipcode), '')
        ) AS location,
        COALESCE(
          occurrence.registration_url_override,
          event.website,
          rl.registration_url,
          rl.external_race_url
        ) AS registration_url,
        stage.key AS stage,
        owner.id::text AS assigned_owner_id,
        owner.name AS assigned_owner,
        queue.touch_count,
        queue.last_touch_at::text,
        queue.last_disposition,
        queue.last_step,
        queue.last_step_at::text,
        queue.next_step,
        queue.next_step_at::text,
        queue.do_not_contact,
        queue.closed_at::text,
        queue.converted_booking_id::text,
        legacy.body AS legacy_note,
        legacy.qualification_status AS legacy_status
      FROM crm.prospects p
      JOIN crm.pipeline_stages stage ON stage.id = p.stage_id
      JOIN crm.prospect_work_queue queue ON queue.prospect_id = p.id
      LEFT JOIN crm.events event ON event.id = p.event_id
      LEFT JOIN catalog.race_listings rl
        ON rl.id = COALESCE(p.race_listing_id, event.catalog_race_listing_id)
      LEFT JOIN catalog.race_editions re ON re.id = p.race_edition_id
      LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = p.occurrence_id
      LEFT JOIN crm.users owner ON owner.id = p.assigned_user_id
      LEFT JOIN catalog.lead_notes legacy ON legacy.race_listing_id = p.race_listing_id
      WHERE p.id = $1::uuid
    `,
    [prospectId],
  );
  if (!prospectResult.rows[0]) return null;

  const [contacts, activities, tasks] = await Promise.all([
    getPool().query(
      `
        SELECT
          id::text,
          type::text,
          raw_value AS value,
          normalized_value,
          label,
          source::text,
          is_primary,
          status::text
        FROM crm.contact_methods
        WHERE (prospect_id = $2::uuid OR
          (prospect_id IS NULL AND race_listing_id = $1))
          AND status <> 'invalid'
        UNION ALL
        SELECT
          person.id::text,
          value.type,
          value.value,
          value.value,
          'Bigin primary contact',
          'manual',
          true,
          'unverified'
        FROM crm.prospects prospect
        JOIN crm.people person ON person.id = prospect.primary_contact_person_id
        CROSS JOIN LATERAL (
          VALUES ('email', person.email), ('phone', person.phone)
        ) value(type, value)
        WHERE prospect.id = $2::uuid AND value.value IS NOT NULL
        ORDER BY type, is_primary DESC
      `,
      [prospectResult.rows[0].race_listing_id, prospectId],
    ),
    getPool().query(
      `
        SELECT
          id::text,
          type::text,
          occurred_at::text,
          body,
          disposition,
          actor_type::text,
          actor_name,
          metadata
        FROM crm.activities
        WHERE prospect_id = $1::uuid
        ORDER BY occurred_at DESC, created_at DESC
      `,
      [prospectId],
    ),
    getPool().query(
      `
        SELECT
          t.id::text,
          t.title,
          t.notes,
          t.due_at::text,
          t.status::text,
          t.completed_at::text,
          t.assigned_user_id::text,
          u.name AS assigned_user
        FROM crm.tasks t
        JOIN crm.users u ON u.id = t.assigned_user_id
        WHERE t.prospect_id = $1::uuid
        ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.due_at
      `,
      [prospectId],
    ),
  ]);

  return {
    ...prospectResult.rows[0],
    contact_methods: contacts.rows,
    activities: activities.rows,
    tasks: tasks.rows,
  };
}
