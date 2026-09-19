"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { importRaceAgeGroupsAction } from "@/app/operations-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import {
  exportAgeGroupFile,
  parseAgeGroupFile,
  suggestAgeGroupEventMappings,
  type AgeGroupFile,
  type AgeGroupFileRace,
} from "@/lib/crm/age-group-file";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

function downloadAgeGroupFile(file: AgeGroupFile, eventName: string) {
  const slug =
    eventName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "age-groups";
  const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}-AgeGroups.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AgeGroupFileTools({
  bookingId,
  occurrenceId,
  eventName,
  races,
}: {
  bookingId: string;
  occurrenceId: string;
  eventName: string;
  races: readonly AgeGroupFileRace[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<AgeGroupFile | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const suggested = useMemo(
    () => (file ? suggestAgeGroupEventMappings(file, races) : {}),
    [file, races],
  );

  function closeImport() {
    setFile(null);
    setMappings({});
    setError(null);
    setSaveFailed(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    try {
      const parsed = parseAgeGroupFile(JSON.parse(await picked.text()));
      setFile(parsed);
      setMappings(suggestAgeGroupEventMappings(parsed, races));
      setError(null);
    } catch (cause) {
      setFile(null);
      setError(
        cause instanceof Error ? cause.message : "That Age Groups file could not be read.",
      );
    }
  }

  async function submit(formData: FormData) {
    setError(null);
    setSuccess(null);
    setSaveFailed(false);
    try {
      const result = await importRaceAgeGroupsAction(formData);
      if (result && result.ok === false) {
        setSaveFailed(true);
        setError(result.message ?? "Could not import age groups.");
        return;
      }
      const imported = result && result.ok ? result.imported : [];
      const message =
        result && result.ok && result.message
          ? result.message
          : "Age groups imported.";
      closeImport();
      setSuccess(message);
      await router.refresh();
      window.setTimeout(() => {
        for (const item of imported) {
          const race = document.getElementById(`occurrence-race-${item.raceId}`);
          if (race instanceof HTMLDetailsElement) race.open = true;
        }
      }, 50);
    } catch (cause) {
      rethrowNextControlFlow(cause);
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not import age groups.");
    }
  }

  const mappedCount = file
    ? file.scoredEvents.filter((event) => mappings[String(event.scored_event_id)]).length
    : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => downloadAgeGroupFile(exportAgeGroupFile(races), eventName)}
          disabled={!races.length}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          Export Age Groups JSON
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={!races.length}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          Import Age Groups JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={onPickFile}
        />
      </div>
      {success ? (
        <p className="mt-2 text-right text-sm font-medium text-emerald-800" role="status">
          {success}
        </p>
      ) : null}
      {error && !file ? (
        <p className="mt-2 text-right text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {file ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="presentation"
          onClick={closeImport}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="age-group-import-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="age-group-import-title" className="text-lg font-bold text-slate-950">
              Import age groups
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Map each event in the file to a race on this booking. Unmapped events
              are skipped.
            </p>
            <FormSaveFailedContext.Provider value={saveFailed}>
              <form action={submit} className="mt-4 space-y-3">
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="occurrenceId" value={occurrenceId} />
                <input
                  type="hidden"
                  name="ageGroupFile"
                  value={JSON.stringify(file)}
                />
                <input
                  type="hidden"
                  name="eventMappings"
                  value={JSON.stringify(mappings)}
                />
                {file.scoredEvents.map((event) => {
                  const key = String(event.scored_event_id);
                  const count = file.ageGroups[key]?.length ?? 0;
                  return (
                    <label key={key} className="block text-sm">
                      {event.scored_event_name}
                      <span className="ml-1 text-slate-500">
                        · {count === 1 ? "1 age group" : `${count} age groups`}
                      </span>
                      <select
                        value={mappings[key] ?? suggested[key] ?? ""}
                        onChange={(change) =>
                          setMappings((current) => ({
                            ...current,
                            [key]: change.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="">Skip this event</option>
                        {races.map((race) => (
                          <option key={race.id} value={race.id}>
                            {race.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
                {error ? (
                  <p className="text-sm text-red-700" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeImport}
                    className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600"
                  >
                    Cancel
                  </button>
                  <PendingSubmitButton
                    disabled={mappedCount === 0}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    pendingLabel="Importing…"
                  >
                    Import
                  </PendingSubmitButton>
                </div>
              </form>
            </FormSaveFailedContext.Provider>
          </div>
        </div>
      ) : null}
    </div>
  );
}
