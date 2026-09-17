"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { addEmailBlacklistAction } from "@/app/blacklist-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import {
  disqualifiedReasonLabels,
  disqualifiedReasons,
} from "@/lib/crm/domain";

export function EmailBlacklistForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState("blacklisted_email");
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const noteRequired = reason === "other";

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    setStatus(null);
    try {
      const result = await addEmailBlacklistAction(formData);
      setStatus(
        result.closed
          ? `Saved. Automatically disqualified ${result.closed} matching ${
              result.closed === 1 ? "lead" : "leads"
            }.`
          : "Saved. Matching leads will be disqualified as they appear.",
      );
      formRef.current?.reset();
      setReason("blacklisted_email");
      router.refresh();
    } catch (cause) {
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not save.");
    }
  }

  return (
    <FormSaveFailedContext.Provider value={saveFailed}>
      <form
        ref={formRef}
        action={submit}
        className="grid gap-3 sm:grid-cols-[1fr_14rem_1fr_auto]"
      >
        <label className="text-sm">
          Email or @domain
          <input
            name="pattern"
            required
            placeholder="info@racecompany.com or @racecompany.com"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          Disqualify reason
          <select
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {disqualifiedReasons.map((key) => (
              <option key={key} value={key}>
                {disqualifiedReasonLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Notes{noteRequired ? " (required)" : ""}
          <input
            name="note"
            required={noteRequired}
            placeholder={noteRequired ? "Why they’re blacklisted" : "Optional"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="flex items-end">
          <PendingSubmitButton
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            pendingLabel="Saving…"
          >
            Add
          </PendingSubmitButton>
        </div>
        {error ? (
          <p className="text-sm text-red-700 sm:col-span-4" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="text-sm text-cyan-800 sm:col-span-4" role="status">
            {status}
          </p>
        ) : null}
      </form>
    </FormSaveFailedContext.Provider>
  );
}
