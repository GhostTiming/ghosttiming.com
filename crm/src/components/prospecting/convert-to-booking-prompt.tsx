"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { convertProspectToBookingAction } from "@/app/booking-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";

export type ConvertBookingOrganization = {
  id: string;
  name: string;
};

export function ConvertToBookingPrompt({
  prospectId,
  directClients,
  organizations,
  canViewFinancials,
  onCancel,
}: {
  prospectId: string;
  directClients: ConvertBookingOrganization[];
  organizations: ConvertBookingOrganization[];
  canViewFinancials: boolean;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [directClientId, setDirectClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const canSave = Boolean(directClientId);

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      await convertProspectToBookingAction(formData);
      onCancel();
      router.refresh();
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "digest" in cause &&
        String(cause.digest).startsWith("NEXT_REDIRECT")
      ) {
        throw cause;
      }
      setSaveFailed(true);
      setError(
        cause instanceof Error ? cause.message : "Could not convert to a booking.",
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
        aria-labelledby="convert-booking-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="convert-booking-title" className="text-lg font-bold text-slate-950">
          Convert to booking
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose the client for this race, then create the booking. Confirmed
          leads move into operations from here.
        </p>
        {directClients.length ? (
          <FormSaveFailedContext.Provider value={saveFailed}>
            <form action={submit} className="mt-4 space-y-3">
              <input type="hidden" name="prospectId" value={prospectId} />
              <label className="block text-sm font-medium">
                Direct client
                <select
                  name="directClientId"
                  required
                  value={directClientId}
                  onChange={(event) => setDirectClientId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Select a client</option>
                  {directClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Event owner (optional)
                <select
                  name="eventOwnerId"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Same as direct client</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
              {canViewFinancials ? (
                <label className="block text-sm font-medium">
                  Expected revenue
                  <input
                    name="expectedRevenue"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              ) : null}
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
                  pendingLabel="Creating…"
                >
                  Create booking
                </PendingSubmitButton>
              </div>
            </form>
          </FormSaveFailedContext.Provider>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-slate-700">
              Add a Direct Client organization before converting this lead.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
