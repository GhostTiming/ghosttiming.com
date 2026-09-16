"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGoogleSession } from "./google-session-provider";

function statusLabel(status: string | undefined, expired: boolean) {
  if (expired) return "Reconnect required";
  switch (status) {
    case "connected":
      return "Connected";
    case "syncing":
      return "Syncing";
    case "synced":
      return "Synced";
    case "error":
      return "Sync error";
    case "expired":
      return "Reconnect required";
    default:
      return "Not connected";
  }
}

export function GoogleConnectionControl() {
  const google = useGoogleSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  function run(label: string, work: () => Promise<void>) {
    if (label === "connect" || label === "add-account") {
      const pending = work();
      setBusy(label);
      pending.then(() => router.refresh()).catch(() => undefined).finally(() => setBusy(null));
      return;
    }
    setBusy(label);
    work().then(() => router.refresh()).catch(() => undefined).finally(() => setBusy(null));
  }

  const connected = Boolean(google.connection && google.accessToken);
  const label = google.progress?.label
    ? google.progress.label
    : google.restoring
      ? "Reconnecting Google…"
      : connected
        ? `Google · ${statusLabel(google.connection?.gmail_status, google.expired)}`
        : google.connection
          ? "Authorize Google"
          : "Connect Google";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/10"
      >
        <span className="block font-medium">{label}</span>
        {google.connection?.google_email ? (
          <span className="block text-[11px] text-slate-400">{google.connection.google_email}</span>
        ) : null}
      </button>
      {open ? (
        <section className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-4 text-slate-950 shadow-lg">
          <h2 className="text-sm font-bold">Google</h2>
          {!google.clientId ? (
            <p className="mt-2 text-sm text-red-700">
              Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Gmail and Calendar.
            </p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {google.connections.length ? (
                <ul className="space-y-1 text-xs">
                  {google.connections.map((item) => (
                    <li key={item.google_sub}>
                      <span className="font-medium">{item.google_email}</span>
                      {" · "}
                      {statusLabel(
                        item.gmail_status,
                        google.expired && item.google_sub === google.connection?.google_sub,
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No Gmail accounts connected yet.</p>
              )}
              <p>
                Active Gmail: {statusLabel(google.connection?.gmail_status, google.expired)}
                {google.connection?.gmail_backfill_completed_at ? " · history loaded" : ""}
              </p>
              <p>
                Calendar: {statusLabel(google.connection?.calendar_status, google.expired)}
                {google.connection?.calendar_summary
                  ? ` · ${google.connection.calendar_summary}`
                  : ""}
              </p>
              {google.pendingCalendarCount ? (
                <p className="text-amber-800">
                  {google.pendingCalendarCount} calendar events need syncing
                </p>
              ) : null}
              {google.progress ? (
                <p className="text-cyan-800">{google.progress.label}</p>
              ) : null}
              {google.error ? <p className="text-red-700">{google.error}</p> : null}
              {google.connection?.gmail_last_error ? (
                <p className="text-red-700">{google.connection.gmail_last_error}</p>
              ) : null}
              {google.calendars.length ? (
                <label className="grid gap-1 text-xs font-medium">
                  Target calendar
                  <select
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    value={google.connection?.calendar_id ?? ""}
                    onChange={(event) => {
                      const selected = google.calendars.find((item) => item.id === event.target.value);
                      if (selected) void google.selectCalendar(selected.id, selected.summary ?? selected.id);
                    }}
                  >
                    {google.calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary ?? calendar.id}
                        {calendar.primary ? " (primary)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => run("connect", () => google.connect())}
                  className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {connected ? "Reauthorize" : google.connection ? "Authorize this session" : "Connect Google"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => run("add-account", () => google.connect({ addAccount: true }))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                >
                  Add another Gmail account
                </button>
                <button
                  type="button"
                  disabled={!connected || Boolean(busy)}
                  onClick={() => run("backfill", google.backfillGmail)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                >
                  Backfill Email History
                </button>
                <button
                  type="button"
                  disabled={!connected || Boolean(busy)}
                  onClick={() => run("gmail", google.syncGmail)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                >
                  Sync Gmail Now
                </button>
                <button
                  type="button"
                  disabled={!connected || Boolean(busy)}
                  onClick={() => run("calendar", google.syncCalendar)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                >
                  Sync Calendar Now
                </button>
                {google.connection ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => run("disconnect", () => google.disconnect(google.connection?.google_sub))}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-700"
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
              <p className="text-[11px] leading-snug text-slate-500">
                Google opens a small popup. If nothing happens, allow popups for this site, or open the CRM in Chrome.
                Add each Gmail account, then backfill while that account is authorized.
              </p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
