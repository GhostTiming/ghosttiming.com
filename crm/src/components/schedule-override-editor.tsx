"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

export function ScheduleOverrideEditor({
  arrivalDisplay,
  departureDisplay,
  arrivalOverridden,
  departureOverridden,
  arrivalOverrideLocal,
  departureOverrideLocal,
}: {
  arrivalDisplay: string;
  departureDisplay: string;
  arrivalOverridden: boolean;
  departureOverridden: boolean;
  arrivalOverrideLocal: string | null;
  departureOverrideLocal: string | null;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase text-slate-500">Arrival / login</p>
          <p className="font-semibold">{arrivalDisplay}</p>
          <p className="text-xs text-slate-500">
            {arrivalOverridden ? "Overridden" : "Automatic · 2 hours before earliest start"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Departure</p>
          <p className="font-semibold">{departureDisplay}</p>
          <p className="text-xs text-slate-500">
            {departureOverridden ? "Overridden" : "Automatic · latest estimated finish"}
          </p>
        </div>
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 hover:text-cyan-900"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {editing ? "Hide overrides" : "Edit"}
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Arrival override
            <input
              name="arrivalOverride"
              type="datetime-local"
              defaultValue={arrivalOverrideLocal ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            Departure override
            <input
              name="departureOverride"
              type="datetime-local"
              defaultValue={departureOverrideLocal ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <>
          <input type="hidden" name="arrivalOverride" value={arrivalOverrideLocal ?? ""} />
          <input type="hidden" name="departureOverride" value={departureOverrideLocal ?? ""} />
        </>
      )}
    </div>
  );
}
