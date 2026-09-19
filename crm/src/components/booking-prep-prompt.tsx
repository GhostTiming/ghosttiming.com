"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { saveBookingPrepItemsAction } from "@/app/booking-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

export type BookingPrepItem = {
  id: string;
  key: string;
  label: string;
  status: "pending" | "complete" | "not_applicable";
  notes: string | null;
};

export function BookingPrepPrompt({
  bookingId,
  items,
  markReady,
  onCancel,
}: {
  bookingId: string;
  items: readonly BookingPrepItem[];
  markReady?: boolean;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, BookingPrepItem["status"]>>(
    () => Object.fromEntries(items.map((item) => [item.id, item.status])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const allLogged = useMemo(
    () =>
      items.every((item) => {
        const status = statuses[item.id] ?? item.status;
        return status === "complete" || status === "not_applicable";
      }),
    [items, statuses],
  );

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      const result = await saveBookingPrepItemsAction(formData);
      if (result && result.ok === false) {
        setSaveFailed(true);
        setError(result.message ?? "Could not save prep.");
        return;
      }
      onCancel();
      router.refresh();
    } catch (cause) {
      rethrowNextControlFlow(cause);
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not save prep.");
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
        aria-labelledby="booking-prep-title"
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="booking-prep-title" className="text-lg font-bold text-slate-950">
          Pre-event prep
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {markReady
            ? "Log every prep item before moving this booking to Ready."
            : "Log crew email and race built status for this booking."}
        </p>
        <FormSaveFailedContext.Provider value={saveFailed}>
          <form action={submit} className="mt-4 space-y-3">
            <input type="hidden" name="bookingId" value={bookingId} />
            {markReady ? <input type="hidden" name="markReady" value="1" /> : null}
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                <input type="hidden" name="itemId" value={item.id} />
                <label className="block text-sm font-medium text-slate-800">
                  {item.label}
                  <select
                    name={`status_${item.id}`}
                    required
                    value={statuses[item.id] ?? item.status}
                    onChange={(event) =>
                      setStatuses((current) => ({
                        ...current,
                        [item.id]: event.target.value as BookingPrepItem["status"],
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  >
                    <option value="pending">Pending</option>
                    <option value="complete">Complete</option>
                    <option value="not_applicable">Not Applicable</option>
                  </select>
                </label>
                <label className="mt-2 block text-sm">
                  Notes
                  <textarea
                    name={`notes_${item.id}`}
                    rows={2}
                    defaultValue={item.notes ?? ""}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
            ))}
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
                disabled={markReady && !allLogged}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                pendingLabel="Saving…"
              >
                {markReady ? "Mark Ready" : "Save prep"}
              </PendingSubmitButton>
            </div>
          </form>
        </FormSaveFailedContext.Provider>
      </div>
    </div>
  );
}
