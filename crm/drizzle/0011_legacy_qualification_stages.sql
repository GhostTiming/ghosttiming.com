INSERT INTO crm.pipeline_stages
  ("pipeline", "key", "name", "sort_order", "is_terminal", "is_active")
VALUES
  ('prospect', 'disqualified', 'Disqualified', 60, true, true),
  ('prospect', 'unqualified', 'Unqualified', 70, true, true)
ON CONFLICT ("pipeline", "key") DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_terminal = EXCLUDED.is_terminal,
  is_active = EXCLUDED.is_active,
  updated_at = now();--> statement-breakpoint
WITH targets AS (
  SELECT
    notes.race_listing_id,
    edition.id AS race_edition_id,
    stage.id AS stage_id,
    listing.name,
    COALESCE(listing.registration_url, listing.external_race_url) AS website,
    COALESCE(edition.starts_at, listing.next_start_at) AS race_date,
    COALESCE(
      edition.edition_year,
      EXTRACT(YEAR FROM listing.next_start_at)::integer
    ) AS occurrence_year,
    COALESCE(edition.timezone, listing.timezone, 'America/New_York') AS timezone,
    listing.street,
    listing.street2,
    listing.city,
    listing.state,
    listing.zipcode
  FROM catalog.lead_notes notes
  JOIN catalog.race_listings listing ON listing.id = notes.race_listing_id
  JOIN crm.pipeline_stages stage
    ON stage.pipeline = 'prospect'
   AND stage.key = CASE
     WHEN notes.qualification_status ILIKE 'disqualified%' THEN 'disqualified'
     WHEN notes.qualification_status ILIKE 'unqualified%' THEN 'unqualified'
   END
  LEFT JOIN LATERAL (
    SELECT id, starts_at, edition_year, timezone
    FROM catalog.race_editions
    WHERE race_listing_id = notes.race_listing_id
      AND is_future = true
    ORDER BY starts_at ASC NULLS LAST
    LIMIT 1
  ) edition ON true
  WHERE notes.qualification_status ILIKE 'disqualified%'
     OR notes.qualification_status ILIKE 'unqualified%'
),
upserted_events AS (
  INSERT INTO crm.events (name, catalog_race_listing_id, source_type, website)
  SELECT name, race_listing_id, 'other', website
  FROM targets
  ON CONFLICT (catalog_race_listing_id) DO UPDATE SET updated_at = now()
  RETURNING id, catalog_race_listing_id
),
edition_occurrences AS (
  INSERT INTO crm.event_occurrences
    (event_id, catalog_race_edition_id, occurrence_year, race_date, timezone,
     registration_url_override, street_override, street2_override,
     city_override, state_override, zipcode_override)
  SELECT event.id, targets.race_edition_id, targets.occurrence_year,
    targets.race_date, targets.timezone, targets.website,
    targets.street, targets.street2, targets.city, targets.state, targets.zipcode
  FROM targets
  JOIN upserted_events event
    ON event.catalog_race_listing_id = targets.race_listing_id
  WHERE targets.race_edition_id IS NOT NULL
  ON CONFLICT (catalog_race_edition_id) DO UPDATE SET updated_at = now()
  RETURNING id, event_id, catalog_race_edition_id
),
fallback_occurrences AS (
  INSERT INTO crm.event_occurrences
    (event_id, occurrence_year, race_date, timezone,
     registration_url_override, street_override, street2_override,
     city_override, state_override, zipcode_override)
  SELECT event.id, targets.occurrence_year, targets.race_date, targets.timezone,
    targets.website, targets.street, targets.street2, targets.city,
    targets.state, targets.zipcode
  FROM targets
  JOIN upserted_events event
    ON event.catalog_race_listing_id = targets.race_listing_id
  WHERE targets.race_edition_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM crm.event_occurrences existing
      WHERE existing.event_id = event.id
    )
  RETURNING id, event_id
),
linked AS (
  SELECT
    targets.race_listing_id,
    targets.race_edition_id,
    targets.stage_id,
    event.id AS event_id,
    COALESCE(
      edition_occurrence.id,
      fallback_occurrence.id,
      existing_occurrence.id
    ) AS occurrence_id
  FROM targets
  JOIN upserted_events event
    ON event.catalog_race_listing_id = targets.race_listing_id
  LEFT JOIN edition_occurrences edition_occurrence
    ON edition_occurrence.catalog_race_edition_id = targets.race_edition_id
  LEFT JOIN fallback_occurrences fallback_occurrence
    ON fallback_occurrence.event_id = event.id
  LEFT JOIN LATERAL (
    SELECT id
    FROM crm.event_occurrences existing
    WHERE existing.event_id = event.id
    ORDER BY race_date DESC NULLS LAST, created_at DESC
    LIMIT 1
  ) existing_occurrence ON true
),
inserted_prospects AS (
  INSERT INTO crm.prospects
    (race_listing_id, race_edition_id, event_id, occurrence_id, stage_id, closed_at)
  SELECT
    linked.race_listing_id,
    linked.race_edition_id,
    linked.event_id,
    linked.occurrence_id,
    linked.stage_id,
    now()
  FROM linked
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.prospects existing
    WHERE existing.race_listing_id = linked.race_listing_id
  )
  ON CONFLICT (race_listing_id, (coalesce(race_edition_id, ''))) DO NOTHING
  RETURNING id
)
UPDATE crm.prospects AS prospect
SET
  stage_id = linked.stage_id,
  event_id = COALESCE(prospect.event_id, linked.event_id),
  occurrence_id = COALESCE(prospect.occurrence_id, linked.occurrence_id),
  closed_at = COALESCE(prospect.closed_at, now()),
  updated_at = now()
FROM linked
WHERE prospect.race_listing_id = linked.race_listing_id
  AND prospect.converted_booking_id IS NULL;--> statement-breakpoint
UPDATE crm.contact_methods AS method
SET prospect_id = prospect.id, updated_at = now()
FROM crm.prospects AS prospect
JOIN catalog.lead_notes AS notes ON notes.race_listing_id = prospect.race_listing_id
WHERE method.race_listing_id = prospect.race_listing_id
  AND method.prospect_id IS NULL
  AND (
    notes.qualification_status ILIKE 'disqualified%'
    OR notes.qualification_status ILIKE 'unqualified%'
  );--> statement-breakpoint
UPDATE crm.prospects AS prospect
SET race_edition_id = future_edition.id, updated_at = now()
FROM catalog.lead_notes AS notes
LEFT JOIN LATERAL (
  SELECT id
  FROM catalog.race_editions
  WHERE race_listing_id = notes.race_listing_id
    AND is_future = true
  ORDER BY starts_at ASC NULLS LAST
  LIMIT 1
) future_edition ON true
WHERE prospect.race_listing_id = notes.race_listing_id
  AND (
    notes.qualification_status ILIKE 'disqualified%'
    OR notes.qualification_status ILIKE 'unqualified%'
  )
  AND prospect.race_edition_id IS DISTINCT FROM future_edition.id;
