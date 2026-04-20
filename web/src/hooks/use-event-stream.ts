"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SnapshotApi } from "@/types/snapshot";
import { RateBuffers } from "@/lib/rate-buffer";

type Conn = "idle" | "connecting" | "live" | "error";

/** Extend aggregated MAC/port rows when live reads arrive (initial snapshot can be empty). */
function patchSnapshotMetaFromReads(
  prev: SnapshotApi,
  newReads: Array<{ mac: string; port: number; ts: string }>,
): SnapshotApi {
  const macsMap = new Map(
    prev.macs.map((m) => [m.mac.toUpperCase(), { ...m }]),
  );
  const portsList = [...prev.ports];

  const findPortIdx = (mac: string, port: number) =>
    portsList.findIndex(
      (p) => p.mac.toUpperCase() === mac.toUpperCase() && p.port === port,
    );

  for (const r of newReads) {
    const mac = r.mac.toUpperCase();
    const tsStr = r.ts;

    const existing = macsMap.get(mac);
    if (!existing) {
      macsMap.set(mac, {
        mac,
        friendlyName: null,
        firstSeen: tsStr,
        lastSeen: tsStr,
        totalReads: 1,
      });
    } else {
      macsMap.set(mac, {
        ...existing,
        lastSeen: tsStr,
        totalReads: existing.totalReads + 1,
      });
    }

    const pci = findPortIdx(mac, r.port);
    if (pci < 0) {
      portsList.push({
        mac,
        port: r.port,
        lastSeen: tsStr,
        totalReads: 1,
      });
    } else {
      const cur = portsList[pci];
      portsList[pci] = {
        ...cur,
        lastSeen: tsStr,
        totalReads: cur.totalReads + 1,
      };
    }
  }

  const macs = [...macsMap.values()].sort((a, b) =>
    a.mac.localeCompare(b.mac),
  );
  return { ...prev, macs, ports: portsList };
}

export function useEventStream(
  shortId: string,
  enabled: boolean,
  onReads?: (
    batch: Array<{ id: string; mac: string; port: number; ts: string }>,
  ) => void,
) {
  const [snapshot, setSnapshot] = useState<SnapshotApi | null>(null);
  const [status, setStatus] = useState<Conn>("idle");
  const [reconnects, setReconnects] = useState(0);
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const buffersRef = useRef(new RateBuffers());

  const applySnapshot = useCallback(
    (
      snap: SnapshotApi,
      opts?: {
        resetBuffers?: boolean;
      },
    ) => {
      const resetBuffers = opts?.resetBuffers ?? true;
    setSnapshot(snap);
      if (resetBuffers) {
        const anchor = Date.now();
        buffersRef.current.seedFromSnapshot(
          snap.recentReads.map((r) => ({
            mac: r.mac,
            port: r.port,
            ts: r.ts,
          })),
          anchor,
        );
      }
    if (snap.recentReads.length > 0) {
      const latest = Math.max(
        ...snap.recentReads.map((r) => new Date(r.ts).getTime()),
      );
      setLastReadAt(latest);
    }
    },
    [],
  );

  const mergeReads = useCallback(
    (batch: Array<{ id: string; mac: string; port: number; ts: string }>) => {
      if (batch.length === 0) return;
      const nowPerf = performance.now();
      const anchorWall = Date.now();
      for (const r of batch) {
        const wall = new Date(r.ts).getTime();
        const age = Math.max(0, anchorWall - wall);
        const t = nowPerf - age;
        buffersRef.current.push(r.mac, String(r.port), t);
      }
      buffersRef.current.prune();
      setSnapshot((prev) => {
        if (!prev) return prev;
        const seen = new Set(prev.recentReads.map((x) => x.id));
        const add = batch.filter((r) => !seen.has(r.id));
        if (add.length === 0) return prev;
        const merged = [...prev.recentReads, ...add];
        const cutoff = Date.now() - 610_000;
        const pruned = merged.filter(
          (x) => new Date(x.ts).getTime() >= cutoff,
        );
        const withMeta = patchSnapshotMetaFromReads(prev, add);
        return {
          ...withMeta,
          recentReads: pruned.slice(-50000),
        };
      });
      const maxWall = batch.reduce(
        (m, r) => Math.max(m, new Date(r.ts).getTime()),
        0,
      );
      if (maxWall > 0) setLastReadAt(maxWall);
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !shortId) return;

    let es: EventSource | null = null;
    let dead = false;
    let attempt = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const pollSnapshotFallback = async () => {
      if (dead) return;
      try {
        const r = await fetch(
          `/api/events/${encodeURIComponent(shortId)}/snapshot`,
          { credentials: "include" },
        );
        if (r.ok) {
          const snap = (await r.json()) as SnapshotApi;
          applySnapshot(snap);
        }
      } catch {
        /* ignore; SSE retry will handle */
      }
      if (!dead && status !== "live") {
        fallbackTimer = setTimeout(pollSnapshotFallback, 5000);
      }
    };

    const connect = () => {
      if (dead) return;
      setStatus("connecting");
      es = new EventSource(
        `/api/events/${encodeURIComponent(shortId)}/stream`,
        { withCredentials: true },
      );

      es.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as SnapshotApi;
          applySnapshot(data);
          setStatus("live");
          setReconnects(0);
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
        } catch {
          setStatus("error");
        }
      });

      es.addEventListener("reads", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            reads: Array<{
              id: string;
              mac: string;
              port: number;
              ts: string;
            }>;
          };
          const rows = data.reads ?? [];
          mergeReads(rows);
          onReads?.(rows);
        } catch {
          /* noop */
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        setStatus("error");
        attempt += 1;
        setReconnects(attempt);
        if (!fallbackTimer) {
          fallbackTimer = setTimeout(pollSnapshotFallback, 2000);
        }
        const delay = Math.min(15_000, 800 + attempt * 700);
        setTimeout(() => {
          if (!dead) connect();
        }, delay);
      };
    };

    connect();

    const iv = setInterval(() => {
      buffersRef.current.prune();
    }, 1000);

    return () => {
      dead = true;
      clearInterval(iv);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortId, enabled, applySnapshot, mergeReads, onReads]);

  return {
    snapshot,
    buffers: buffersRef,
    status,
    reconnects,
    lastReadAt,
    applySnapshot,
  };
}
