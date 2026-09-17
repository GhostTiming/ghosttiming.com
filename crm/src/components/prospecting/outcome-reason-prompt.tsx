"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { closeCandidateListingAction } from "@/app/candidate-actions";
import { updateProspectStageAction } from "@/app/prospect-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

export function OutcomeReasonPrompt({
  prospectId,
  raceListingId,
  stageKey,
  title,
  description,
  reasons,
  submitLabel,
  action,
  onCancel,
}: {
  prospectId?: string;
  raceListingId?: string;
  stageKey: "unqualified" | "disqualified";
  title: string;
  description: string;
  reasons: ReadonlyArray<{ key: string; label: string }>;
  submitLabel: string;
  action?: (formData: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const noteRequired = reason === "other";
  const canSave = Boolean(reason) && (!noteRequired || note.trim());

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      if (raceListingId) {
        await closeCandidateListingAction(formData);
        return;
      }
      await (action ?? updateProspectStageAction)(formData);
      onCancel();
      router.refresh();
    } catch (cause) {
      rethrowNextControlFlow(cause);
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not save.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outcome-reason-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="outcome-reason-title" className="text-lg font-bold text-slate-950">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
        <FormSaveFailedContext.Provider value={saveFailed}>
          <form action={submit} className="mt-4 space-y-3">
            {prospectId ? <input type="hidden" name="prospectId" value={prospectId} /> : null}
            {raceListingId ? (
              <input type="hidden" name="raceListingId" value={raceListingId} />
            ) : null}
            <input type="hidden" name="stageKey" value={stageKey} />
            <label className="block text-sm">
              Reason
              <select
                name="outcomeReason"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Select a reason</option>
                {reasons.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Notes{noteRequired ? " (required)" : ""}
              <textarea
                name="outcomeNote"
                rows={3}
                required={noteRequired}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            {error ? (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>
              <PendingSubmitButton
                disabled={!canSave}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                pendingLabel="Saving…"
              >
                {submitLabel}
              </PendingSubmitButton>
            </div>
          </form>
        </FormSaveFailedContext.Provider>
      </div>
    </div>
  );
}
