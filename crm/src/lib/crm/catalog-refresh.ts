import type { PoolClient } from "pg";
import { appendAuditActivity } from "./audit";
import { syncOccurrenceRacesFromCatalog } from "./race-operations";

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

/** Stages that should not be rewritten from catalog. */
export const catalogRefreshTerminalStages = ["paid", "closed_lost"] as const;

export function shouldSkipCatalogRefresh(input: {
  stageKey?: string | null;
  raceDate?: string | Date | null;
  now?: Date;
}) {
  const stage = input.stageKey?.trim().toLowerCase() ?? "";
  if (
    (catalogRefreshTerminalStages as readonly string[]).includes(stage)
  ) {
    return stage === "paid"
      ? "Already paid — left unchanged."
      : "Closed lost — left unchanged.";
  }
  if (!input.raceDate) return null;
  const raceMs =
    input.raceDate instanceof Date
      ? input.raceDate.valueOf()
      : new Date(input.raceDate).valueOf();
  if (Number.isNaN(raceMs)) return null;
  const now = input.now ?? new Date();
  if (raceMs < now.valueOf()) {
    return "Past race date — left unchanged.";
  }
  return null;
}

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
    listing_id: string | null;
    stage_key: string | null;
    race_date: string | null;
  }>(
    `
      SELECT occurrence.id::text AS occurrence_id,
             event.catalog_race_listing_id AS listing_id,
             stage.key AS stage_key,
             occurrence.race_date::text
      FROM crm.bookings booking
      JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
      JOIN crm.events event ON event.id = occurrence.event_id
      JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
      WHERE booking.id = $1::uuid
    `,
    [input.bookingId],
  );
  const row = booking.rows[0];
  if (!row) {
    return { bookingId: input.bookingId, status: "failed", error: "Booking not found." };
  }
  if (!row.listing_id) {
    return {
      bookingId: input.bookingId,
      status: "skipped",
      error: "Not linked to a catalog listing.",
    };
  }
  const skipReason = shouldSkipCatalogRefresh({
    stageKey: row.stage_key,
    raceDate: row.race_date,
  });
  if (skipReason) {
    return {
      bookingId: input.bookingId,
      status: "skipped",
      error: skipReason,
    };
  }
  const result = await syncOccurrenceRacesFromCatalog(client, row.occurrence_id);
  await appendAuditActivity(
    client,
    { bookingId: input.bookingId },
    input.actor,
    result.inserted
      ? `Refreshed ${result.inserted} race${result.inserted === 1 ? "" : "s"} from catalog`
      : "Refreshed from catalog",
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
