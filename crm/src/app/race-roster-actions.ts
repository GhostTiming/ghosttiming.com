"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireAdminConsole } from "@/lib/auth/server";
import { syncRaceRosterEventsToCatalog } from "@/lib/race-roster/sync";

export type SyncRaceRosterActionResult = {
  ok: boolean;
  message: string;
  fetched?: number;
  upserted?: number;
  skipped?: number;
};

export async function syncRaceRosterCatalogAction(
  formData: FormData,
): Promise<SyncRaceRosterActionResult> {
  await requireAdminConsole();

  const input = z
    .object({
      eventIds: z.string().trim().optional(),
      dryRun: z.enum(["0", "1"]).optional(),
    })
    .parse({
      eventIds: formData.get("eventIds") || undefined,
      dryRun: formData.get("dryRun") === "1" ? "1" : "0",
    });

  const eventIds = (input.eventIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const dryRun = input.dryRun === "1";

  const client = await getPool().connect();
  try {
    if (!dryRun) await client.query("BEGIN");
    const result = await syncRaceRosterEventsToCatalog(client, {
      eventIds: eventIds.length ? eventIds : undefined,
      dryRun,
    });
    if (!dryRun) await client.query("COMMIT");

    revalidatePath("/admin");
    revalidatePath("/bookings");
    revalidatePath("/prospecting");

    const message = dryRun
      ? `Dry run fetched ${result.fetched} Race Roster event${result.fetched === 1 ? "" : "s"} (no catalog writes).`
      : `Synced ${result.upserted} Race Roster listing${result.upserted === 1 ? "" : "s"} into the catalog (${result.fetched} fetched).`;

    return {
      ok: true,
      message,
      fetched: result.fetched,
      upserted: result.upserted,
      skipped: result.skipped,
    };
  } catch (error) {
    if (!dryRun) await client.query("ROLLBACK");
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Race Roster sync failed.",
    };
  } finally {
    client.release();
  }
}
