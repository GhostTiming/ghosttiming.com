"use client";

import { useState, useTransition } from "react";
import {
  syncRaceRosterCatalogAction,
  type SyncRaceRosterActionResult,
} from "@/app/race-roster-actions";

export function SyncRaceRosterPanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncRaceRosterActionResult | null>(null);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">Race Roster catalog sync</h2>
      <p className="mt-1 text-sm text-slate-500">
        Pull timer-accessible Race Roster events into the shared catalog. Matching
        a booking or prospect still uses the normal catalog search — Race Roster
        and Get Run Vibes listings appear together.
      </p>
      <form
        className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          const dryRun = formData.get("dryRun") === "1";
          if (
            !dryRun &&
            !window.confirm(
              "Pull Race Roster events into the catalog now? Linked bookings are not changed until you refresh them from catalog.",
            )
          ) {
            return;
          }
          startTransition(async () => {
            const outcome = await syncRaceRosterCatalogAction(formData);
            setResult(outcome);
          });
        }}
      >
        <label className="text-sm md:col-span-1">
          Event IDs (optional)
          <input
            name="eventIds"
            placeholder="Leave blank for all visible timer events"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-medium text-slate-700">
          <input type="checkbox" name="dryRun" value="1" className="size-4" />
          Dry run
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
          >
            {pending ? "Syncing…" : "Sync Race Roster"}
          </button>
        </div>
      </form>
      {result ? (
        <p
          className={`mt-3 text-sm ${result.ok ? "text-slate-700" : "text-red-700"}`}
          role="status"
        >
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
