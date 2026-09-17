"use client";

import { Calendar, Check, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ListRowActions } from "@/components/list-row";
import { useOptionalGoogleSession } from "@/components/google/google-session-provider";

export function isTaskCalendarSynced(status: string | null | undefined) {
  return status === "synced";
}

export function TaskCalendarSyncControl({
  taskId,
  syncStatus,
}: {
  taskId: string;
  syncStatus: string | null;
}) {
  const google = useOptionalGoogleSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticSynced, setOptimisticSynced] = useState(false);
  const syncStarted = useRef(false);
  const synced = optimisticSynced || isTaskCalendarSynced(syncStatus);

  useEffect(() => {
    if (syncStatus !== "synced") setOptimisticSynced(false);
  }, [syncStatus]);

  async function performSync() {
    if (!google) throw new Error("Google is not available.");
    if (syncStatus === "deleted") {
      await google.unlinkTaskEvent(taskId);
      await google.createTaskEvent(taskId);
      return;
    }
    if (syncStatus === "needs_sync" || syncStatus === "error") {
      await google.updateTaskEvent(taskId);
      return;
    }
    await google.createTaskEvent(taskId);
  }

  async function runSync() {
    if (syncStarted.current) return;
    syncStarted.current = true;
    setError(null);
    setBusy(true);
    try {
      await performSync();
      setOptimisticSynced(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Calendar sync failed.");
    } finally {
      syncStarted.current = false;
      setBusy(false);
    }
  }

  const icons = (
    <span className="inline-flex items-center gap-0.5">
      <Calendar className="size-3.5" aria-hidden />
      {synced ? (
        <Check className="size-3.5 stroke-[2.5]" aria-hidden />
      ) : (
        <XCircle className="size-3.5" aria-hidden />
      )}
    </span>
  );

  if (synced) {
    return (
      <span
        className="inline-flex shrink-0 items-center text-emerald-600"
        title="Calendar invite synced"
      >
        {icons}
        <span className="sr-only">Calendar invite synced</span>
      </span>
    );
  }

  return (
    <ListRowActions className="inline-flex shrink-0">
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!google) {
            setError("Google is not available.");
            return;
          }
          if (!google.accessToken) {
            void google.connect().catch((caught) => {
              setError(caught instanceof Error ? caught.message : "Google authorization failed.");
            });
            return;
          }
          void runSync();
        }}
        title={error ?? "Sync with calendar"}
        aria-label={error ?? "Sync with calendar"}
        className="inline-flex items-center gap-1 rounded-md text-red-600 hover:text-red-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icons}
        <span className="text-[11px] font-semibold leading-none">Sync with calendar</span>
      </button>
    </ListRowActions>
  );
}
