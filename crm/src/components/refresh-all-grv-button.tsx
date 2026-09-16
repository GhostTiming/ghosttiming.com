"use client";

import { useState } from "react";
import type { BulkActionResult } from "@/app/bulk-actions";
import { refreshAllLinkedBookingsFromCatalogAction } from "@/app/bulk-actions";

export function RefreshAllGrvButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (
      !window.confirm(
        "Refresh every booking linked to Get Run Vibes? This can take a while.",
      )
    ) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const outcome: BulkActionResult =
        await refreshAllLinkedBookingsFromCatalogAction();
      setMessage(outcome.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Refreshing…" : "Refresh all from Get Run Vibes"}
      </button>
      {message ? <p className="max-w-xs text-right text-xs text-slate-600">{message}</p> : null}
    </div>
  );
}
