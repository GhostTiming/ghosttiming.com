"use client";

import { CalendarPlus, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  catalogRaceDateMismatchMessage,
  type CatalogRaceDateMismatch,
} from "@/lib/crm/race-operations";
import { useOptionalGoogleSession } from "./google-session-provider";

export type BookingCalendarLink = {
  google_calendar_id: string;
  google_event_id: string;
  html_link: string | null;
  sync_status: string;
  last_error: string | null;
  last_synced_at: string | null;
  google_email: string;
} | null;

function statusCopy(status: string | null) {
  switch (status) {
    case "synced":
      return "Synced";
    case "needs_sync":
      return "Needs Sync";
    case "error":
      return "Sync Error";
    case "deleted":
      return "Event deleted in Google";
    default:
      return "Not Linked";
  }
}

export function BookingCalendarCard({
  bookingId,
  link,
  canCreate,
  templateUrl,
  dateMismatch,
}: {
  bookingId: string;
  link: BookingCalendarLink;
  canCreate: boolean;
  templateUrl: string | null;
  dateMismatch?: CatalogRaceDateMismatch | null;
}) {
  const google = useOptionalGoogleSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = link?.sync_status ?? null;
  const attemptedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!google?.accessToken || status !== "needs_sync") return;
    const key = `${bookingId}:${link?.google_event_id ?? ""}`;
    if (attemptedKey.current === key) return;
    attemptedKey.current = key;
    setBusy(true);
    void google
      .updateBookingEvent(bookingId)
      .then(() => router.refresh())
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Calendar sync failed."))
      .finally(() => setBusy(false));
  }, [bookingId, google, google?.accessToken, link?.google_event_id, router, status]);

  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google Calendar action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm text-slate-300">
        Google Calendar — {statusCopy(status)}
        {link?.google_email ? ` · ${link.google_email}` : ""}
      </p>
      {link?.last_error ? <p className="text-sm text-amber-200">{link.last_error}</p> : null}
      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!link && canCreate ? (
          <button
            type="button"
            disabled={busy || !google?.accessToken}
            onClick={() => google && void run(() => google.createBookingEvent(bookingId))}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
          >
            <CalendarPlus className="size-5" />
            {google?.accessToken ? "Create Google Calendar Event" : "Authorize Google to create event"}
          </button>
        ) : null}
        {link?.html_link ? (
          <a
            href={link.html_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 font-semibold text-white hover:bg-white/20"
          >
            <ExternalLink className="size-4" /> Open in Google Calendar
          </a>
        ) : null}
        {link && status !== "deleted" ? (
          <button
            type="button"
            disabled={busy || !google?.accessToken}
            onClick={() => google && void run(() => google.updateBookingEvent(bookingId))}
            className="rounded-lg bg-white/10 px-4 py-2.5 font-semibold text-white hover:bg-white/20 disabled:opacity-60"
          >
            {status === "error" ? "Retry" : "Sync Now"}
          </button>
        ) : null}
        {status === "deleted" ? (
          <button
            type="button"
            disabled={busy || !google?.accessToken}
            onClick={() =>
              google &&
              void run(async () => {
                await google.unlinkBookingEvent(bookingId);
                await google.createBookingEvent(bookingId);
              })
            }
            className="rounded-lg bg-cyan-400 px-4 py-2.5 font-semibold text-slate-950"
          >
            Recreate Calendar Event
          </button>
        ) : null}
        {link ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => google && void run(() => google.unlinkBookingEvent(bookingId))}
            className="rounded-lg px-4 py-2.5 font-semibold text-slate-300 hover:text-white"
          >
            Unlink
          </button>
        ) : null}
        {!link && templateUrl ? (
          <a
            href={templateUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
          >
            Open calendar template
          </a>
        ) : null}
      </div>
      {!canCreate && !link && dateMismatch ? (
        <p className="text-sm text-amber-200">
          {catalogRaceDateMismatchMessage(dateMismatch)}
        </p>
      ) : null}
      {!canCreate && !link && !dateMismatch ? (
        <p className="text-sm text-slate-400">
          Add race start times and durations to enable Google Calendar.
        </p>
      ) : null}
    </div>
  );
}
