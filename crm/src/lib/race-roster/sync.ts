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
  const listing = mapped.listing;
  const hasCoords =
    listing.latitude != null &&
    listing.longitude != null &&
    Number.isFinite(listing.latitude) &&
    Number.isFinite(listing.longitude);

  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM catalog.race_listings
      WHERE source_provider = $1
        AND source_race_id = $2
      LIMIT 1
    `,
    [RACE_ROSTER_PROVIDER, listing.sourceRaceId],
  );
  const listingId = existing.rows[0]?.id ?? randomUUID();
  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE catalog.race_listings SET
          name = $1,
          slug = $2,
          description_html = $3,
          logo_url = $4,
          registration_url = $5,
          external_race_url = $6,
          external_results_url = $7,
          street = $8,
          street2 = $9,
          city = $10,
          state = $11,
          zipcode = $12,
          country_code = $13,
          timezone = $14,
          latitude = $15,
          longitude = $16,
          coordinate_source = $17,
          coordinate_confidence = $18,
          is_registration_open = $19,
          first_start_at = $20::timestamp,
          last_start_at = $21::timestamp,
          next_start_at = $22::timestamptz,
          future_offering_count = $23,
          historical_offering_count = $24,
          total_offering_count = $25,
          source_last_fetched_at = $26::timestamptz,
          source_last_modified_rsu = $27,
          updated_at = now()
        WHERE id = $28
      `,
      [
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
        listingId,
      ],
    );
  } else {
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
  }

  const edition = mapped.edition;
  const existingEdition = await client.query<{ id: string }>(
    `
      SELECT id
      FROM catalog.race_editions
      WHERE source_provider = $1
        AND source_race_id = $2
        AND source_race_event_days_id = $3
      LIMIT 1
    `,
    [
      edition.sourceProvider,
      edition.sourceRaceId,
      edition.sourceRaceEventDaysId,
    ],
  );
  const editionId = existingEdition.rows[0]?.id ?? randomUUID();
  if (existingEdition.rows[0]) {
    await client.query(
      `
        UPDATE catalog.race_editions SET
          race_listing_id = $1,
          edition_year = $2,
          starts_at = $3::timestamp,
          timezone = $4,
          is_future = $5,
          is_historical = $6,
          offering_count = $7,
          future_offering_count = $8,
          historical_offering_count = $9,
          source_last_fetched_at = $10::timestamptz,
          updated_at = now()
        WHERE id = $11
      `,
      [
        listingId,
        edition.editionYear,
        edition.startsAt,
        edition.timezone,
        edition.isFuture,
        edition.isHistorical,
        edition.offeringCount,
        edition.futureOfferingCount,
        edition.historicalOfferingCount,
        listing.sourceLastFetchedAt,
        editionId,
      ],
    );
  } else {
    await client.query(
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
      `,
      [
        editionId,
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
  }

  for (const offering of mapped.offerings) {
    const existingOffering = await client.query<{ id: string }>(
      `
        SELECT id
        FROM catalog.race_offerings
        WHERE source_provider = $1
          AND source_race_id = $2
          AND source_event_id = $3
        LIMIT 1
      `,
      [
        offering.sourceProvider,
        offering.sourceRaceId,
        offering.sourceEventId,
      ],
    );
    const offeringId = existingOffering.rows[0]?.id ?? randomUUID();
    if (existingOffering.rows[0]) {
      await client.query(
        `
          UPDATE catalog.race_offerings SET
            race_listing_id = $1,
            race_edition_id = $2,
            source_race_event_days_id = $3,
            name = $4,
            start_time_raw = $5,
            starts_at = $6::timestamp,
            event_type = $7,
            normalized_event_family = $8,
            distance_label = $9,
            distance_meters = $10,
            is_real_race_distance = $11,
            is_virtual = $12,
            is_walk = $13,
            is_merch_only = $14,
            is_volunteer = $15,
            registration_periods_json = $16::jsonb,
            raw_json = $17::jsonb,
            source_last_fetched_at = $18::timestamptz,
            updated_at = now()
          WHERE id = $19
        `,
        [
          listingId,
          editionId,
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
          offeringId,
        ],
      );
    } else {
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
        `,
        [
          offeringId,
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
