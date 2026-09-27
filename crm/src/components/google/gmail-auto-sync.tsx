"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useGoogleSession } from "./google-session-provider";

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const FOLLOW_UP_MS = 1_500;
const MAX_FOLLOW_UPS = 8;

export function GmailAutoSync() {
  const google = useGoogleSession();
  const router = useRouter();
  const canSync = google.connections.some(
    (row) => row.has_offline_grant && row.gmail_status !== "disconnected",
  );

  useEffect(() => {
    if (!canSync) return;
    let cancelled = false;
    let running = false;
    let followUps = 0;
    let followUpTimer = 0;
    const interval = window.setInterval(() => {
      followUps = 0;
      void sync();
    }, SYNC_INTERVAL_MS);

    async function sync() {
      if (cancelled || running) return;
      running = true;
      try {
        const response = await fetch("/api/google/gmail/auto-sync", { method: "POST" });
        if (cancelled || response.status === 401 || response.status === 403) return;
        if (!response.ok) return;
        const body = (await response.json()) as {
          createdActivities?: number;
          more?: boolean;
        };
        if ((body.createdActivities ?? 0) > 0) router.refresh();
        if (body.more && followUps < MAX_FOLLOW_UPS) {
          followUps += 1;
          followUpTimer = window.setTimeout(() => void sync(), FOLLOW_UP_MS);
        }
      } catch {
        // The next interval tries again. A missed sync should not interrupt the page.
      } finally {
        running = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        followUps = 0;
        void sync();
      }
    };

    void sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(followUpTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [canSync, router]);

  return null;
}
