"use client";

import { unlinkBookingCatalogListingAction } from "@/app/booking-actions";
import { unlinkProspectCatalogListingAction } from "@/app/prospect-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";

export function UncoupleCatalogButton({
  bookingId,
  prospectId,
}: {
  bookingId?: string;
  prospectId?: string;
}) {
  const action = prospectId
    ? unlinkProspectCatalogListingAction
    : unlinkBookingCatalogListingAction;

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Uncouple this from Get Run Vibes so you can match a different listing or year?",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
      {prospectId ? (
        <input type="hidden" name="prospectId" value={prospectId} />
      ) : null}
      <PendingSubmitButton
        pendingLabel="Uncoupling…"
        className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-60"
      >
        Uncouple listing
      </PendingSubmitButton>
    </form>
  );
}
