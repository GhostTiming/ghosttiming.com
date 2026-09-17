"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { wrapUpMeetingAction } from "@/app/outreach-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import {
  unqualifiedReasonLabels,
  unqualifiedReasons,
} from "@/lib/crm/domain";
import type { OutreachRecordKind } from "@/lib/crm/outreach-activity";

export function MeetingWrapUpButton({
  activityId,
  recordKind,
}: {
  activityId: string;
  recordKind: OutreachRecordKind;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"qualified" | "unqualified" | "notes">(
    recordKind === "booking" ? "notes" : "qualified",
  );
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      await wrapUpMeetingAction(formData);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not save wrap-up.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-semibold text-cyan-700 hover:text-cyan-900"
      >
        Meeting wrap-up
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-wrapup-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="meeting-wrapup-title" className="text-lg font-bold text-slate-950">
              Meeting wrap-up
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Log what happened after the meeting, the same way Salesforce captures
              event follow-up on the record.
            </p>
            <form action={submit} className="mt-4 grid gap-3">
              <input type="hidden" name="activityId" value={activityId} />
              {recordKind === "prospect" ? (
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-semibold">Outcome</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="outcome"
                      value="qualified"
                      checked={outcome === "qualified"}
                      onChange={() => setOutcome("qualified")}
                    />
                    Qualified
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="outcome"
                      value="unqualified"
                      checked={outcome === "unqualified"}
                      onChange={() => setOutcome("unqualified")}
                    />
                    Unqualified
                  </label>
                </fieldset>
              ) : (
                <input type="hidden" name="outcome" value="notes" />
              )}
              {recordKind === "prospect" && outcome === "unqualified" ? (
                <label className="grid gap-1 text-sm font-medium">
                  Unqualification reason
                  <select
                    name="unqualifiedReason"
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">Choose a reason</option>
                    {unqualifiedReasons.map((item) => (
                      <option key={item} value={item}>
                        {unqualifiedReasonLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="grid gap-1 text-sm font-medium">
                What happened
                <textarea
                  name="notes"
                  required
                  rows={4}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={
                    outcome === "unqualified"
                      ? "Why this lead is not a fit"
                      : "Notes from the meeting"
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <FormSaveFailedContext.Provider value={saveFailed}>
                  <PendingSubmitButton className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60">
                    Save wrap-up
                  </PendingSubmitButton>
                </FormSaveFailedContext.Provider>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
