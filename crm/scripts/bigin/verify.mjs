import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const expected = {
  account: 146,
  contact: 255,
  calendar_event: 32,
  prospect: 240,
  booking: 224,
  task: 193,
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const external = await pool.query(
    `SELECT entity_type, count(*)::integer AS count
     FROM crm.external_records
     WHERE source = 'bigin'
     GROUP BY entity_type
     ORDER BY entity_type`,
  );
  const actual = Object.fromEntries(
    external.rows.map((row) => [row.entity_type, row.count]),
  );
  for (const [type, count] of Object.entries(expected)) {
    if (actual[type] !== count) {
      throw new Error(`Expected ${count} ${type} mappings; found ${actual[type] ?? 0}.`);
    }
  }

  const integrity = await pool.query(
    `SELECT
       count(DISTINCT occurrence.id)::integer AS occurrences,
       count(DISTINCT occurrence.event_id)::integer AS referenced_events,
       (SELECT count(DISTINCT event.id)::integer
        FROM crm.events event
        WHERE EXISTS (
          SELECT 1 FROM crm.external_records account_mapping
          WHERE account_mapping.source = 'bigin'
            AND account_mapping.entity_type = 'account'
            AND account_mapping.local_id = event.id
        )
        OR EXISTS (
          SELECT 1
          FROM crm.event_occurrences imported_occurrence
          JOIN crm.external_records pipeline_mapping
            ON pipeline_mapping.local_id IN (
              SELECT imported_prospect.id FROM crm.prospects imported_prospect
              WHERE imported_prospect.occurrence_id = imported_occurrence.id
              UNION ALL
              SELECT imported_booking.id FROM crm.bookings imported_booking
              WHERE imported_booking.occurrence_id = imported_occurrence.id
            )
          WHERE imported_occurrence.event_id = event.id
            AND pipeline_mapping.source = 'bigin'
            AND pipeline_mapping.entity_type IN ('prospect', 'booking')
        )) AS event_targets,
       count(DISTINCT CASE WHEN prospect.id IS NOT NULL THEN mapping.local_id END)::integer
         AS prospects,
       count(DISTINCT CASE WHEN booking.id IS NOT NULL THEN mapping.local_id END)::integer
         AS bookings
     FROM crm.external_records mapping
     LEFT JOIN crm.prospects prospect
       ON mapping.entity_type = 'prospect' AND prospect.id = mapping.local_id
     LEFT JOIN crm.bookings booking
       ON mapping.entity_type = 'booking' AND booking.id = mapping.local_id
     LEFT JOIN crm.event_occurrences occurrence
       ON occurrence.id = COALESCE(prospect.occurrence_id, booking.occurrence_id)
     WHERE mapping.source = 'bigin'
       AND mapping.entity_type IN ('prospect', 'booking')`,
  );
  const targets = await pool.query(
    `SELECT
       count(*) FILTER (
         WHERE mapping.entity_type = 'account'
           AND organization.id IS NULL AND event.id IS NULL
       )::integer AS missing_accounts,
       count(*) FILTER (
         WHERE mapping.entity_type = 'contact' AND person.id IS NULL
       )::integer AS missing_contacts,
       count(*) FILTER (
         WHERE mapping.entity_type = 'calendar_event' AND occurrence.id IS NULL
       )::integer AS missing_calendar_events,
       count(*) FILTER (
         WHERE mapping.entity_type = 'prospect' AND prospect.id IS NULL
       )::integer AS missing_prospects,
       count(*) FILTER (
         WHERE mapping.entity_type = 'booking' AND booking.id IS NULL
       )::integer AS missing_bookings,
       count(*) FILTER (
         WHERE mapping.entity_type = 'task' AND task.id IS NULL
       )::integer AS missing_tasks
     FROM crm.external_records mapping
     LEFT JOIN crm.organizations organization ON organization.id = mapping.local_id
     LEFT JOIN crm.events event ON event.id = mapping.local_id
     LEFT JOIN crm.people person ON person.id = mapping.local_id
     LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = mapping.local_id
     LEFT JOIN crm.prospects prospect ON prospect.id = mapping.local_id
     LEFT JOIN crm.bookings booking ON booking.id = mapping.local_id
     LEFT JOIN crm.tasks task ON task.id = mapping.local_id
     WHERE mapping.source = 'bigin'`,
  );
  if (Object.values(targets.rows[0]).some((count) => count !== 0)) {
    throw new Error(`Missing import targets: ${JSON.stringify(targets.rows[0])}`);
  }

  const stages = await pool.query(
    `SELECT stage.pipeline, stage.name, count(*)::integer AS count
     FROM crm.external_records mapping
     JOIN crm.prospects prospect
       ON mapping.entity_type = 'prospect' AND prospect.id = mapping.local_id
     JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
     WHERE mapping.source = 'bigin'
     GROUP BY stage.pipeline, stage.name
     UNION ALL
     SELECT stage.pipeline, stage.name, count(*)::integer AS count
     FROM crm.external_records mapping
     JOIN crm.bookings booking
       ON mapping.entity_type = 'booking' AND booking.id = mapping.local_id
     JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
     WHERE mapping.source = 'bigin'
     GROUP BY stage.pipeline, stage.name
     ORDER BY pipeline, name`,
  );
  const relatedTasks = await pool.query(
    `SELECT
       count(*)::integer AS total,
       count(*) FILTER (
         WHERE (task.prospect_id IS NOT NULL)::integer +
               (task.booking_id IS NOT NULL)::integer +
               (task.organization_id IS NOT NULL)::integer = 1
       )::integer AS valid
     FROM crm.external_records mapping
     JOIN crm.tasks task ON task.id = mapping.local_id
     WHERE mapping.source = 'bigin' AND mapping.entity_type = 'task'`,
  );
  if (relatedTasks.rows[0].total !== relatedTasks.rows[0].valid) {
    throw new Error("One or more imported tasks has an invalid related record.");
  }
  const primaryContacts = await pool.query(
    `SELECT
       count(*) FILTER (
         WHERE NULLIF(mapping.raw_data->>'Contact Name.id', '') IS NOT NULL
       )::integer AS source_links,
       count(*) FILTER (
         WHERE COALESCE(prospect.primary_contact_person_id,
                        booking.primary_contact_person_id) IS NOT NULL
       )::integer AS imported_links
     FROM crm.external_records mapping
     LEFT JOIN crm.prospects prospect
       ON mapping.entity_type = 'prospect' AND prospect.id = mapping.local_id
     LEFT JOIN crm.bookings booking
       ON mapping.entity_type = 'booking' AND booking.id = mapping.local_id
     WHERE mapping.source = 'bigin'
       AND mapping.entity_type IN ('prospect', 'booking')`,
  );
  if (primaryContacts.rows[0].source_links !== primaryContacts.rows[0].imported_links) {
    throw new Error(
      `Primary-contact reconciliation failed: ${JSON.stringify(primaryContacts.rows[0])}`,
    );
  }

  const operations = await pool.query(
    `SELECT
       (SELECT count(DISTINCT occurrence.id)::integer
        FROM crm.external_records mapping
        JOIN crm.bookings booking ON booking.id = mapping.local_id
        JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
        WHERE mapping.source = 'bigin' AND mapping.entity_type = 'booking')
         AS booking_occurrences,
       (SELECT count(*)::integer FROM crm.occurrence_races race
        WHERE EXISTS (
          SELECT 1 FROM crm.external_records mapping
          JOIN crm.bookings booking ON booking.id = mapping.local_id
          WHERE mapping.source = 'bigin' AND mapping.entity_type = 'booking'
            AND booking.occurrence_id = race.occurrence_id
        )) AS races,
       (SELECT count(*)::integer FROM crm.course_points point
        WHERE EXISTS (
          SELECT 1 FROM crm.external_records mapping
          JOIN crm.bookings booking ON booking.id = mapping.local_id
          WHERE mapping.source = 'bigin' AND mapping.entity_type = 'booking'
            AND booking.occurrence_id = point.occurrence_id
        )) AS course_points,
       (SELECT count(*)::integer FROM crm.crew_assignments crew
        WHERE EXISTS (
          SELECT 1 FROM crm.external_records mapping
          JOIN crm.bookings booking ON booking.id = mapping.local_id
          WHERE mapping.source = 'bigin' AND mapping.entity_type = 'booking'
            AND booking.occurrence_id = crew.occurrence_id
        )) AS crew_assignments`,
  );

  const result = {
    external_records: actual,
    imported_relationships: integrity.rows[0],
    stages: stages.rows,
    tasks: relatedTasks.rows[0],
    primary_contacts: primaryContacts.rows[0],
    operations: operations.rows[0],
  };
  if (
    result.imported_relationships.occurrences !== 464 ||
    result.imported_relationships.referenced_events !== 369 ||
    result.imported_relationships.event_targets !== 370 ||
    result.imported_relationships.prospects !== 240 ||
    result.imported_relationships.bookings !== 224
  ) {
    throw new Error(`Relationship reconciliation failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ verified: true, ...result }, null, 2));
} finally {
  await pool.end();
}
