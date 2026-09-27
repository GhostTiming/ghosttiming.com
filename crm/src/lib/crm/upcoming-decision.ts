import type { PoolClient } from "pg";
import {
  renewBooking,
  UPCOMING_DECISION_STAGE_KEY,
} from "./booking-renewal";

export type UpcomingDecisionActor = {
  id: string | null;
  name: string;
  type?: "human" | "ai" | "system";
};

export type UpcomingDecisionCreated = {
  bookingId: string;
  eventName: string;
  year: number;
};

/**
 * An event already timed (paid or completed) gets an awaiting-decision booking
 * when the online listing has an upcoming year that is not already booked.
 * Confirmed, paid, closed, and archived years are left alone.
 */
export async function ensureUpcomingDecisionBookings(
  client: PoolClient,
  input: {
    actor: UpcomingDecisionActor;
    organizationIds?: string[] | null;
  },
): Promise<{
  created: UpcomingDecisionCreated[];
  failed: Array<{ eventName: string; year: number; error: string }>;
}> {
  const candidates = await client.query<{
    event_name: string;
    source_booking_id: string;
    target_year: number;
  }>(
    `
      WITH timed AS (
        SELECT DISTINCT ON (event.id)
          event.id AS event_id,
          event.name AS event_name,
          event.catalog_race_listing_id AS listing_id,
          booking.id::text AS source_booking_id
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
        JOIN crm.events event ON event.id = occurrence.event_id
        JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
        WHERE booking.archived_at IS NULL
          AND stage.pipeline = 'booking'
          AND stage.key IN ('paid', 'completed')
          AND event.catalog_race_listing_id IS NOT NULL
          AND ($1::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($1::uuid[]))
        ORDER BY event.id, occurrence.race_date DESC NULLS LAST, booking.created_at DESC
      ),
      upcoming AS (
        SELECT DISTINCT ON (timed.event_id, target_year)
          timed.event_id,
          timed.event_name,
          timed.source_booking_id,
          COALESCE(
            edition.edition_year,
            EXTRACT(YEAR FROM edition.starts_at)::integer
          ) AS target_year
        FROM timed
        JOIN catalog.race_editions edition
          ON edition.race_listing_id = timed.listing_id
        WHERE edition.starts_at > now()
        ORDER BY timed.event_id, target_year, edition.starts_at
      )
      SELECT upcoming.event_name,
             upcoming.source_booking_id,
             upcoming.target_year
      FROM upcoming
      WHERE upcoming.target_year IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM crm.bookings booking
          JOIN crm.event_occurrences occurrence
            ON occurrence.id = booking.occurrence_id
          WHERE occurrence.event_id = upcoming.event_id
            AND (
              occurrence.occurrence_year = upcoming.target_year
              OR EXTRACT(
                YEAR FROM occurrence.race_date
                  AT TIME ZONE COALESCE(occurrence.timezone, 'America/New_York')
              )::integer = upcoming.target_year
            )
        )
      ORDER BY upcoming.target_year, upcoming.event_name
    `,
    [input.organizationIds ?? null],
  );

  const created: UpcomingDecisionCreated[] = [];
  const failed: Array<{ eventName: string; year: number; error: string }> = [];
  for (const candidate of candidates.rows) {
    await client.query("SAVEPOINT upcoming_decision");
    try {
      const result = await renewBooking(client, {
        bookingId: candidate.source_booking_id,
        actor: input.actor,
        targetYear: candidate.target_year,
        refreshFromCatalog: true,
        stageKey: UPCOMING_DECISION_STAGE_KEY,
        reuseStandingEvent: true,
      });
      created.push({
        bookingId: result.bookingId,
        eventName: candidate.event_name,
        year: candidate.target_year,
      });
      await client.query("RELEASE SAVEPOINT upcoming_decision");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT upcoming_decision");
      failed.push({
        eventName: candidate.event_name,
        year: candidate.target_year,
        error: error instanceof Error ? error.message : "Could not add this year.",
      });
    }
  }
  return { created, failed };
}
