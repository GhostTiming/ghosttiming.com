import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  authorizeRaceRoster,
  readRaceRosterCredentialsFromEnv,
} from "./auth";
import { getRaceRosterEvent, listRaceRosterEvents } from "./api";
import { mapRaceRosterEvent } from "./map-event";
import { RACE_ROSTER_PROVIDER } from "./types";
import type { MappedRaceRosterEvent, RaceRosterEvent } from "./types";

export type RaceRosterSyncOptions = {
  eventIds?: Array<string | number>;
  lastModifiedDate?: string;
  dryRun?: boolean;
};

export type RaceRosterSyncResult = {
  fetched: number;
  upserted: number;
  skipped: number;
  listingIds: string[];
  dryRun: boolean;
  refreshToken?: string;
};

async function upsertMappedEvent(
  client: PoolClient,
  mapped: MappedRaceRosterEvent,
) {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM catalog.race_listings
      WHERE source_provider = $1
        AND source_race_id = $2
      LIMIT 1
    `,
    [RACE_ROSTER_PROVIDER, mapped.listing.sourceRaceId],
  );
  const listingId = existing.rows[0]?.id ?? randomUUID();
  const listing = mapped.listing;
  const hasCoords =
    listing.latitude != null &&
    listing.longitude != null &&
    Number.isFinite(listing.latitude) &&
    Number.isFinite(listing.longitude);

  await client.query(
    `
      INSERT INTO catalog.race_listings (
        id,
        source_provider,
        source_race_id,
        name,
        slug,
        description_html,
        logo_url,
        registration_url,
        external_race_url,
        external_results_url,
        street,
        street2,
        city,
        state,
        zipcode,
        country_code,
        timezone,
        latitude,
        longitude,
        coordinate_source,
        coordinate_confidence,
        is_registration_open,
        first_start_at,
        last_start_at,
        next_start_at,
        future_offering_count,
        historical_offering_count,
        total_offering_count,
        show_on_public_browse,
        public_status,
        source_last_fetched_at,
        source_last_modified_rsu,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22,
        $23::timestamp, $24::timestamp, $25::timestamptz,
        $26, $27, $28,
        true, 'candidate',
        $29::timestamptz, $30, now()
      )
      ON CONFLICT (source_provider, source_race_id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        description_html = EXCLUDED.description_html,
        logo_url = EXCLUDED.logo_url,
        registration_url = EXCLUDED.registration_url,
        external_race_url = EXCLUDED.external_race_url,
        external_results_url = EXCLUDED.external_results_url,
        street = EXCLUDED.street,
        street2 = EXCLUDED.street2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zipcode = EXCLUDED.zipcode,
        country_code = EXCLUDED.country_code,
        timezone = EXCLUDED.timezone,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        coordinate_source = EXCLUDED.coordinate_source,
        coordinate_confidence = EXCLUDED.coordinate_confidence,
        is_registration_open = EXCLUDED.is_registration_open,
        first_start_at = EXCLUDED.first_start_at,
        last_start_at = EXCLUDED.last_start_at,
        next_start_at = EXCLUDED.next_start_at,
        future_offering_count = EXCLUDED.future_offering_count,
        historical_offering_count = EXCLUDED.historical_offering_count,
        total_offering_count = EXCLUDED.total_offering_count,
        source_last_fetched_at = EXCLUDED.source_last_fetched_at,
        source_last_modified_rsu = EXCLUDED.source_last_modified_rsu,
        updated_at = now()
      RETURNING id
    `,
    [
      listingId,
      listing.sourceProvider,
      listing.sourceRaceId,
      listing.name,
      listing.slug,
      listing.descriptionHtml,
      listing.logoUrl,
      listing.registrationUrl,
      listing.externalRaceUrl,
      listing.externalResultsUrl,
      listing.street,
      listing.street2,
      listing.city,
      listing.state,
      listing.zipcode,
      listing.countryCode,
      listing.timezone,
      listing.latitude,
      listing.longitude,
      hasCoords ? "race_roster" : "unknown",
      hasCoords ? "high" : "unknown",
      listing.isRegistrationOpen,
      listing.firstStartAt,
      listing.lastStartAt,
      listing.nextStartAt,
      mapped.edition.futureOfferingCount,
      mapped.edition.historicalOfferingCount,
      mapped.offerings.length,
      listing.sourceLastFetchedAt,
      listing.sourceLastModified,
    ],
  );

  const edition = mapped.edition;
  const editionResult = await client.query<{ id: string }>(
    `
      INSERT INTO catalog.race_editions (
        id,
        race_listing_id,
        source_provider,
        source_race_id,
        source_race_event_days_id,
        edition_year,
        starts_at,
        timezone,
        is_future,
        is_historical,
        offering_count,
        future_offering_count,
        historical_offering_count,
        source_last_fetched_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7::timestamp, $8, $9, $10, $11, $12, $13,
        $14::timestamptz, now()
      )
      ON CONFLICT (source_provider, source_race_id, source_race_event_days_id)
      DO UPDATE SET
        race_listing_id = EXCLUDED.race_listing_id,
        edition_year = EXCLUDED.edition_year,
        starts_at = EXCLUDED.starts_at,
        timezone = EXCLUDED.timezone,
        is_future = EXCLUDED.is_future,
        is_historical = EXCLUDED.is_historical,
        offering_count = EXCLUDED.offering_count,
        future_offering_count = EXCLUDED.future_offering_count,
        historical_offering_count = EXCLUDED.historical_offering_count,
        source_last_fetched_at = EXCLUDED.source_last_fetched_at,
        updated_at = now()
      RETURNING id
    `,
    [
      randomUUID(),
      listingId,
      edition.sourceProvider,
      edition.sourceRaceId,
      edition.sourceRaceEventDaysId,
      edition.editionYear,
      edition.startsAt,
      edition.timezone,
      edition.isFuture,
      edition.isHistorical,
      edition.offeringCount,
      edition.futureOfferingCount,
      edition.historicalOfferingCount,
      listing.sourceLastFetchedAt,
    ],
  );
  const editionId = editionResult.rows[0]!.id;

  for (const offering of mapped.offerings) {
    await client.query(
      `
        INSERT INTO catalog.race_offerings (
          id,
          race_listing_id,
          race_edition_id,
          source_provider,
          source_race_id,
          source_event_id,
          source_race_event_days_id,
          name,
          start_time_raw,
          starts_at,
          event_type,
          normalized_event_family,
          distance_label,
          distance_meters,
          is_real_race_distance,
          is_virtual,
          is_walk,
          is_merch_only,
          is_volunteer,
          registration_periods_json,
          raw_json,
          source_last_fetched_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10::timestamp, $11, $12, $13, $14,
          $15, $16, $17, $18, $19,
          $20::jsonb, $21::jsonb,
          $22::timestamptz, now()
        )
        ON CONFLICT (source_provider, source_race_id, source_event_id)
        DO UPDATE SET
          race_listing_id = EXCLUDED.race_listing_id,
          race_edition_id = EXCLUDED.race_edition_id,
          source_race_event_days_id = EXCLUDED.source_race_event_days_id,
          name = EXCLUDED.name,
          start_time_raw = EXCLUDED.start_time_raw,
          starts_at = EXCLUDED.starts_at,
          event_type = EXCLUDED.event_type,
          normalized_event_family = EXCLUDED.normalized_event_family,
          distance_label = EXCLUDED.distance_label,
          distance_meters = EXCLUDED.distance_meters,
          is_real_race_distance = EXCLUDED.is_real_race_distance,
          is_virtual = EXCLUDED.is_virtual,
          is_walk = EXCLUDED.is_walk,
          is_merch_only = EXCLUDED.is_merch_only,
          is_volunteer = EXCLUDED.is_volunteer,
          registration_periods_json = EXCLUDED.registration_periods_json,
          raw_json = EXCLUDED.raw_json,
          source_last_fetched_at = EXCLUDED.source_last_fetched_at,
          updated_at = now()
      `,
      [
        randomUUID(),
        listingId,
        editionId,
        offering.sourceProvider,
        offering.sourceRaceId,
        offering.sourceEventId,
        offering.sourceRaceEventDaysId,
        offering.name,
        offering.startTimeRaw,
        offering.startsAt,
        offering.eventType,
        offering.normalizedEventFamily,
        offering.distanceLabel,
        offering.distanceMeters,
        offering.isRealRaceDistance,
        offering.isVirtual,
        offering.isWalk,
        offering.isMerchOnly,
        offering.isVolunteer,
        JSON.stringify(offering.registrationPeriodsJson),
        JSON.stringify(offering.rawJson),
        listing.sourceLastFetchedAt,
      ],
    );
  }

  return listingId;
}

export async function syncRaceRosterEventsToCatalog(
  client: PoolClient,
  options: RaceRosterSyncOptions = {},
): Promise<RaceRosterSyncResult> {
  const credentials = readRaceRosterCredentialsFromEnv();
  const token = await authorizeRaceRoster(credentials);

  let events: RaceRosterEvent[];
  if (options.eventIds?.length === 1) {
    events = [await getRaceRosterEvent(token.access_token, options.eventIds[0]!)];
  } else {
    events = await listRaceRosterEvents(token.access_token, {
      eventIds: options.eventIds,
      lastModifiedDate: options.lastModifiedDate,
    });
  }

  const listingIds: string[] = [];
  let skipped = 0;

  for (const event of events) {
    if (!event?.name?.trim() || event.eventId == null) {
      skipped += 1;
      continue;
    }
    const mapped = mapRaceRosterEvent(event);
    if (options.dryRun) {
      listingIds.push(`dry-run:${mapped.listing.sourceRaceId}`);
      continue;
    }
    const listingId = await upsertMappedEvent(client, mapped);
    listingIds.push(listingId);
  }

  return {
    fetched: events.length,
    upserted: options.dryRun ? 0 : listingIds.length,
    skipped,
    listingIds,
    dryRun: Boolean(options.dryRun),
    refreshToken: token.refresh_token,
  };
}
