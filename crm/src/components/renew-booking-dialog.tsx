"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { renewBookingAction } from "@/app/booking-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import {
  defaultRenewalYear,
  shiftLocalDateTimeByYears,
} from "@/lib/crm/booking-renewal";

export function RenewBookingDialog({
  bookingId,
  eventName,
  raceDateLocal,
  occurrenceYear,
  timezone,
  registrationUrl,
  street,
  street2,
  city,
  state,
  zipcode,
  catalogLinked,
}: {
  bookingId: string;
  eventName: string;
  raceDateLocal: string | null;
  occurrenceYear: number | null;
  timezone: string;
  registrationUrl: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  catalogLinked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [targetYear, setTargetYear] = useState(() =>
    defaultRenewalYear({
      raceDate: raceDateLocal,
      occurrenceYear,
    }),
  );
  const [refreshFromCatalog, setRefreshFromCatalog] = useState(catalogLinked);
  const sourceYear =
    occurrenceYear ??
    (raceDateLocal ? Number(raceDateLocal.slice(0, 4)) : targetYear - 1);
  const yearDelta = targetYear - sourceYear;
  const nextRaceDate = useMemo(
    () => shiftLocalDateTimeByYears(raceDateLocal, yearDelta) ?? "",
    [raceDateLocal, yearDelta],
  );
  const showManualFields = !catalogLinked || !refreshFromCatalog;

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      const result = await renewBookingAction(formData);
      if ("error" in result) {
        setSaveFailed(true);
        setError(result.error ?? "Could not renew this booking.");
        return;
      }
      setOpen(false);
      router.push(`/bookings/${result.bookingId}`);
    } catch (cause) {
      setSaveFailed(true);
      setError(
        cause instanceof Error ? cause.message : "Could not renew this booking.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setSaveFailed(false);
          setTargetYear(
            defaultRenewalYear({ raceDate: raceDateLocal, occurrenceYear }),
          );
          setRefreshFromCatalog(catalogLinked);
          setOpen(true);
        }}
        className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
      >
        Renew Booking
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
            aria-labelledby="renew-booking-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-950 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="renew-booking-title" className="text-lg font-bold">
              Renew Booking
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Create next year’s booking from this one. Client, crew, and
              operational notes copy over. Race-day completion and payments
              stay on the original.
            </p>
            <FormSaveFailedContext.Provider value={saveFailed}>
              <form action={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="bookingId" value={bookingId} />
                <label className="text-sm sm:col-span-2">
                  Year
                  <input
                    required
                    type="number"
                    min={2000}
                    max={2100}
                    name="targetYear"
                    value={targetYear}
                    onChange={(event) =>
                      setTargetYear(Number(event.target.value) || targetYear)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                {catalogLinked ? (
                  <label className="flex items-start gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      name="refreshFromCatalog"
                      value="1"
                      checked={refreshFromCatalog}
                      onChange={(event) =>
                        setRefreshFromCatalog(event.target.checked)
                      }
                      className="mt-1"
                    />
                    <span>
                      Refresh from Get Run Vibes
                      <span className="block font-normal text-slate-500">
                        Pull the current year’s listing details (dates, location,
                        logo, race offerings, name) into the new booking.
                      </span>
                    </span>
                  </label>
                ) : (
                  <p className="text-sm text-slate-500 sm:col-span-2">
                    This booking is not linked to Get Run Vibes. Dates and
                    location can be edited below; the rest still copies.
                  </p>
                )}
                {showManualFields ? (
                  <>
                    <label className="text-sm sm:col-span-2">
                      Event name
                      <input
                        required
                        name="eventName"
                        defaultValue={eventName}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      Date and time
                      <input
                        type="datetime-local"
                        name="raceDate"
                        defaultValue={nextRaceDate}
                        key={`${targetYear}-${nextRaceDate}`}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      Timezone
                      <input
                        required
                        name="timezone"
                        defaultValue={timezone}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm sm:col-span-2">
                      Registration URL
                      <input
                        type="url"
                        name="registrationUrl"
                        defaultValue={registrationUrl ?? ""}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm sm:col-span-2">
                      Street
                      <input
                        name="street"
                        defaultValue={street ?? ""}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      Street 2
                      <input
                        name="street2"
                        defaultValue={street2 ?? ""}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      City
                      <input
                        name="city"
                        defaultValue={city ?? ""}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      State
                      <input
                        name="state"
                        defaultValue={state ?? ""}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      ZIP code
                      <input
                        name="zipcode"
                        defaultValue={zipcode ?? ""}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </>
                ) : null}
                {error ? (
                  <p className="text-sm text-red-700 sm:col-span-2">{error}</p>
                ) : null}
                <div className="flex justify-end gap-2 sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <PendingSubmitButton
                    pendingLabel="Creating…"
                    className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
                  >
                    Create renewal
                  </PendingSubmitButton>
                </div>
              </form>
            </FormSaveFailedContext.Provider>
          </div>
        </div>
      ) : null}
    </>
  );
}
