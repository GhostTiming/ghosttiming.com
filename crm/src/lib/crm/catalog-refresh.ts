import type { PoolClient } from "pg";
import { appendAuditActivity } from "./audit";
import { refreshOccurrenceFromOnlineListing } from "./online-listings";

export type CatalogRefreshStatus = "updated" | "skipped" | "failed";

export type CatalogRefreshRow = {
  bookingId: string;
  status: CatalogRefreshStatus;
  error?: string;
};

export type CatalogRefreshSummary = {
  updated: number;
  skipped: number;
  failed: number;
  rows: CatalogRefreshRow[];
};

export function summarizeCatalogRefresh(rows: CatalogRefreshRow[]): CatalogRefreshSummary {
  return {
    updated: rows.filter((row) => row.status === "updated").length,
    skipped: rows.filter((row) => row.status === "skipped").length,
    failed: rows.filter((row) => row.status === "failed").length,
    rows,
  };
}

export function formatCatalogRefreshSummary(summary: CatalogRefreshSummary) {
  const parts = [
    `${summary.updated} updated`,
    `${summary.skipped} skipped`,
    `${summary.failed} failed`,
  ];
  const firstError = summary.rows.find((row) => row.error)?.error;
  return firstError ? `${parts.join(", ")}. ${firstError}` : parts.join(", ");
}

export async function refreshBookingFromCatalog(
  client: PoolClient,
  input: {
    bookingId: string;
    actor: { id: string; name: string };
  },
): Promise<CatalogRefreshRow> {
  const booking = await client.query<{
    occurrence_id: string;
    event_id: string;
    listing_id: string | null;
    source_type: string;
    external_source_id: string | null;
  }>(
    `
      SELECT occurrence.id::text AS occurrence_id,
             event.id::text AS event_id,
             event.catalog_race_listing_id AS listing_id,
             event.source_type::text AS source_type,
             event.external_source_id
      FROM crm.bookings booking
      JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
      JOIN crm.events event ON event.id = occurrence.event_id
      WHERE booking.id = $1::uuid
    `,
    [input.bookingId],
  );
  const row = booking.rows[0];
  if (!row) {
    return { bookingId: input.bookingId, status: "failed", error: "Booking not found." };
  }
  if (!row.listing_id && !(row.source_type === "runsignup" && row.external_source_id)) {
    return {
      bookingId: input.bookingId,
      status: "skipped",
      error: "Not linked to an online listing.",
    };
  }
  const result = await refreshOccurrenceFromOnlineListing(client, {
    eventId: row.event_id,
    occurrenceId: row.occurrence_id,
  });
  await appendAuditActivity(
    client,
    { bookingId: input.bookingId },
    input.actor,
    result.inserted
      ? `Refreshed ${result.inserted} race${result.inserted === 1 ? "" : "s"} from the online listing`
      : "Refreshed from the online listing",
  );
  return { bookingId: input.bookingId, status: "updated" };
}

export async function refreshBookingsFromCatalog(
  client: PoolClient,
  input: {
    bookingIds: string[];
    actor: { id: string; name: string };
  },
): Promise<CatalogRefreshSummary> {
  const rows: CatalogRefreshRow[] = [];
  for (const bookingId of input.bookingIds) {
    try {
      await client.query("SAVEPOINT catalog_refresh");
      rows.push(
        await refreshBookingFromCatalog(client, {
          bookingId,
          actor: input.actor,
        }),
      );
      await client.query("RELEASE SAVEPOINT catalog_refresh");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT catalog_refresh");
      rows.push({
        bookingId,
        status: "failed",
        error: error instanceof Error ? error.message : "Refresh failed.",
      });
    }
  }
  return summarizeCatalogRefresh(rows);
}
