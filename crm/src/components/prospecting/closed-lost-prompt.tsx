"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateProspectStageAction } from "@/app/prospect-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import {
  closedLostReasonLabels,
  closedLostReasons,
} from "@/lib/crm/domain";
import { rethrowIfNextControlFlow } from "@/lib/next-control-flow";

export function ClosedLostPrompt({
  prospectId,
  onCancel,
}: {
  prospectId: string;
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
      await updateProspectStageAction(formData);
      onCancel();
      router.refresh();
    } catch (cause) {
      rethrowIfNextControlFlow(cause);
      setSaveFailed(true);
      setError(
        cause instanceof Error ? cause.message : "Could not close as lost.",
      );
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
        aria-labelledby="closed-lost-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="closed-lost-title" className="text-lg font-bold text-slate-950">
          Close as lost
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose why this prospect was lost before changing the stage.
        </p>
        <FormSaveFailedContext.Provider value={saveFailed}>
        <form action={submit} className="mt-4 space-y-3">
          <input type="hidden" name="prospectId" value={prospectId} />
          <input type="hidden" name="stageKey" value="closed_lost" />
          <label className="block text-sm">
            Reason
            <select
              name="closedLostReason"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Select a reason</option>
              {closedLostReasons.map((key) => (
                <option key={key} value={key}>
                  {closedLostReasonLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Circle back
            <input
              type="date"
              name="circleBackOn"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Notes{noteRequired ? " (required)" : ""}
            <textarea
              name="closedLostNote"
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
              Close lost
            </PendingSubmitButton>
          </div>
        </form>
        </FormSaveFailedContext.Provider>
      </div>
    </div>
  );
}
