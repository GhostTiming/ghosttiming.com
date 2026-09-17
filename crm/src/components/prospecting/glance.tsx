"use client";

import { useState } from "react";
import { updateProspectGlanceAction } from "@/app/prospect-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

function formatLastStepDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export function ProspectGlance({
  prospectId,
  ownerName,
  touchCount,
  lastStepLabel,
  lastStepAt,
  lastStepNote,
  nextStepOn,
  nextStepNote,
}: {
  prospectId: string;
  ownerName: string | null;
  touchCount: number;
  lastStepLabel: string | null;
  lastStepAt: string | null;
  lastStepNote: string | null;
  nextStepOn: string | null;
  nextStepNote: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const lastStepDate = formatLastStepDate(lastStepAt);

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      await updateProspectGlanceAction(formData);
    } catch (cause) {
      rethrowNextControlFlow(cause);
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not save steps.");
    }
  }

  return (
    <FormSaveFailedContext.Provider value={saveFailed}>
    <form
      action={submit}
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <input type="hidden" name="prospectId" value={prospectId} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            At a glance
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Owner {ownerName ?? "Unassigned"} · {touchCount}{" "}
            {touchCount === 1 ? "touch" : "touches"}
          </p>
        </div>
        <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">
          Save steps
        </PendingSubmitButton>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 border-b border-slate-200 pb-4">
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Last step
            </p>
            <p className="mt-1 text-sm font-medium text-slate-950">
              {lastStepLabel ?? "None yet"}
              {lastStepDate ? ` · ${lastStepDate}` : ""}
            </p>
          </div>
          <label className="grid gap-1 text-sm font-medium">
            Note
            <textarea
              name="lastStepNote"
              rows={2}
              defaultValue={lastStepNote ?? ""}
              placeholder="Optional detail"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>
      </div>

      <div className="border-b border-slate-200 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Next step
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <label className="grid gap-1 text-sm font-medium">
            Date
            <input
              type="date"
              name="nextStepOn"
              defaultValue={nextStepOn ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Task
            <input
              name="nextStepNote"
              defaultValue={nextStepNote ?? ""}
              placeholder="What should happen next"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>
      </div>
    </form>
    </FormSaveFailedContext.Provider>
  );
}
