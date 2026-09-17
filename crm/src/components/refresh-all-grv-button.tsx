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
        "Refresh every booking linked to an online listing? This can take a while.",
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
    <div className="flex w-full flex-col items-stretch gap-1 sm:w-auto sm:items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Refreshing…" : "Refresh all from online listings"}
      </button>
      {message ? <p className="max-w-xs text-right text-xs text-slate-600">{message}</p> : null}
    </div>
  );
}
