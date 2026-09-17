"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGoogleSession } from "./google-session-provider";

export function ResyncGmailButton({
  emails,
  prospectId,
  bookingId,
  tone = "light",
}: {
  emails: string[];
  prospectId?: string;
  bookingId?: string;
  tone?: "light" | "dark";
}) {
  const google = useGoogleSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasEmails = emails.length > 0;
  const connected = Boolean(google.connection && google.accessToken);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      if (!google.accessToken) {
        await google.connect();
      }
      await google.syncGmailForEmails(emails, {
        prospectIds: prospectId ? [prospectId] : undefined,
        bookingIds: bookingId ? [bookingId] : undefined,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gmail re-sync failed.");
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? google.progress?.label || "Re-syncing Gmail…"
    : connected
      ? "Re-sync Gmail"
      : "Authorize Google to re-sync";

  const className =
    tone === "dark"
      ? "inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-60"
      : "inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy || !hasEmails || !google.clientId}
        title={
          hasEmails
            ? `Search Gmail for ${emails.join(", ")}`
            : "Add an email address first"
        }
        onClick={() => void run()}
        className={className}
      >
        <RefreshCw aria-hidden className={`size-4 ${busy ? "animate-spin" : ""}`} />
        {label}
      </button>
      {error ? (
        <p className={`text-xs ${tone === "dark" ? "text-amber-200" : "text-red-700"}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
