"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  antennaShade,
  MAC_BASE_PALETTE_RGB,
  portSortKey,
  rgbToHex,
} from "@/lib/colors";
import { useEventStream } from "@/hooks/use-event-stream";
import { FilterPanel } from "@/components/dashboard/FilterPanel";
import { LiveChart } from "@/components/dashboard/LiveChart";
import { HeatmapCanvas } from "@/components/dashboard/HeatmapCanvas";
import {
  autoWorkspaceFromSnapshot,
  parseWorkspacePayload,
  rebuildHeatmapSlots,
} from "@/lib/workspace";
import type { WorkspacePayload } from "@/types/workspace";

type Gate = "checking" | "login" | "live";

const POLL_MS = 1500;

function formatRelative(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 5) return "just now";
  if (sec < 90) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ago`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

/**
 * Live viewer: polls `/snapshot` on a fixed interval. Counts and timestamps
 * come only from the API (DB aggregates) — no SSE merge or client-side totals,
 * so refresh never shows inconsistent “fuzzy” numbers.
 */
export function EventDashboard({ shortId }: { shortId: string }) {
  const toast = useToast();
  const [gate, setGate] = useState<Gate>("checking");
  const [password, setPassword] = useState("");
  const [lastPollOkAt, setLastPollOkAt] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [macsOn, setMacsOn] = useState<Record<string, boolean>>({});
  const [antsOn, setAntsOn] = useState<Record<string, boolean>>({});
  /** Bumps once per second so “Xs ago” updates without new fetches. */
  const [tick, setTick] = useState(0);
  const stream = useEventStream(shortId, gate === "live");
  const snapshot = stream.snapshot;

  const loadSnapshot = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/events/${encodeURIComponent(shortId)}/snapshot`,
        { credentials: "include", cache: "no-store" },
      );
      if (r.ok) {
        setGate("live");
        setLastPollOkAt(Date.now());
        setPollError(null);
        return;
      }
      if (r.status === 401) {
        setGate("login");
        return;
      }
      if (r.status === 410) {
        toast({
          title: "This event is closed.",
          variant: "destructive",
        });
        setGate("login");
        return;
      }
      setPollError(`Could not load snapshot (HTTP ${r.status})`);
    } catch {
      setPollError("Network error — retrying…");
    }
  }, [shortId, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGate("checking");
      try {
        await loadSnapshot();
      } catch {
        if (!cancelled) setPollError("Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shortId, loadSnapshot]);

  useEffect(() => {
    if (gate !== "live" || stream.status === "live") return;
    const id = window.setInterval(() => {
      void loadSnapshot();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [gate, loadSnapshot, stream.status]);

  useEffect(() => {
    if (gate !== "live") return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [gate]);

  const eventTitle = snapshot?.name ?? "";

  const friendly = useMemo(() => {
    const m = new Map<string, string>();
    if (!snapshot) return m;
    for (const row of snapshot.macs) {
      if (row.friendlyName) m.set(row.mac.toUpperCase(), row.friendlyName);
    }
    return m;
  }, [snapshot]);

  const macIndex = useMemo(() => {
    const m = new Map<string, number>();
    if (!snapshot) return m;
    const macs = [...snapshot.macs]
      .map((x) => x.mac.toUpperCase())
      .sort((a, b) => a.localeCompare(b));
    macs.forEach((mac, i) => m.set(mac, i));
    return m;
  }, [snapshot]);

  const displayMac = useCallback(
    (mac: string) => {
      const fn = friendly.get(mac.toUpperCase());
      return fn ? `${mac} (${fn})` : mac;
    },
    [friendly],
  );

  const macHex = useCallback(
    (mac: string) => {
      const idx = macIndex.get(mac.toUpperCase()) ?? 0;
      const p = MAC_BASE_PALETTE_RGB[idx % MAC_BASE_PALETTE_RGB.length];
      return rgbToHex([p[0], p[1], p[2]]);
    },
    [macIndex],
  );

  const sortedPorts = useMemo(() => {
    if (!snapshot) return [];
    const rows = [...snapshot.ports];
    // Safety net: if aggregate port rows are missing, derive mats from recent
    // reads so the viewer still renders live data.
    if (rows.length === 0 && snapshot.recentReads.length > 0) {
      const agg = new Map<string, { mac: string; port: number; totalReads: number; lastSeen: string }>();
      for (const r of snapshot.recentReads) {
        const mac = String(r.mac || "").toUpperCase();
        const port = Number(r.port);
        if (!mac || !Number.isFinite(port)) continue;
        const key = `${mac}:${port}`;
        const cur = agg.get(key);
        if (!cur) {
          agg.set(key, { mac, port, totalReads: 1, lastSeen: r.ts });
          continue;
        }
        cur.totalReads += 1;
        if (new Date(r.ts).getTime() > new Date(cur.lastSeen).getTime()) {
          cur.lastSeen = r.ts;
        }
      }
      rows.push(...agg.values());
    }
    rows.sort((a, b) => {
      const ma = a.mac.toUpperCase().localeCompare(b.mac.toUpperCase());
      if (ma !== 0) return ma;
      const pa = portSortKey(String(a.port));
      const pb = portSortKey(String(b.port));
      if (pa[0] !== pb[0]) return pa[0] - pb[0];
      return String(pa[1]).localeCompare(String(pb[1]));
    });
    return rows;
  }, [snapshot]);

  const portTotals = useMemo(() => {
    const m = new Map<string, number>();
    if (!snapshot) return m;
    for (const p of snapshot.ports) {
      m.set(`${p.mac.toUpperCase()}:${p.port}`, Number(p.totalReads));
    }
    return m;
  }, [snapshot]);

  const lastSeenWall = useMemo(() => {
    const m = new Map<string, number>();
    if (!snapshot) return m;
    for (const p of snapshot.ports) {
      const t = new Date(p.lastSeen).getTime();
      if (!Number.isNaN(t)) {
        m.set(`${p.mac.toUpperCase()}:${p.port}`, t);
      }
    }
    return m;
  }, [snapshot]);

  const buffersWall = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const p of sortedPorts) {
      const mac = p.mac.toUpperCase();
      const port = String(p.port);
      const t = new Date(p.lastSeen).getTime();
      const cur = m.get(mac) ?? new Map<string, number>();
      cur.set(port, t);
      m.set(mac, cur);
    }
    return m;
  }, [sortedPorts]);

  const workspaces = useMemo(() => {
    if (!snapshot) return [];
    const rows = snapshot.workspaces.map((w) => ({
      workspaceId: w.workspaceId,
      payload: parseWorkspacePayload(w.payload),
    }));
    if (rows.length === 0) {
      const auto = autoWorkspaceFromSnapshot(snapshot);
      if (auto) {
        rows.push({ workspaceId: "auto", payload: auto });
      }
    }
    return rows;
  }, [snapshot]);

  useEffect(() => {
    if (!workspaces.length) return;
    setWorkspaceId((prev) => {
      if (prev && workspaces.some((w) => w.workspaceId === prev)) return prev;
      return workspaces[0]?.workspaceId ?? "";
    });
  }, [workspaces]);

  const activeWorkspace = useMemo<WorkspacePayload | null>(() => {
    if (!workspaceId) return workspaces[0]?.payload ?? null;
    return workspaces.find((w) => w.workspaceId === workspaceId)?.payload ?? null;
  }, [workspaces, workspaceId]);

  const slots = useMemo(() => {
    if (!activeWorkspace?.heatmap) return [];
    return rebuildHeatmapSlots(
      activeWorkspace.heatmap.row1,
      activeWorkspace.heatmap.row2,
      activeWorkspace.heatmap.left,
      activeWorkspace.heatmap.right,
      activeWorkspace.heatmap.slots,
    );
  }, [activeWorkspace]);

  const newestLastSeenMs = useMemo(() => {
    if (!snapshot?.ports.length) return null;
    let max = 0;
    for (const p of snapshot.ports) {
      const t = new Date(p.lastSeen).getTime();
      if (!Number.isNaN(t) && t > max) max = t;
    }
    return max || null;
  }, [snapshot]);

  /** Wall clock for “Xs ago”; `tick` bumps every 1s so this stays fresh. */
  const nowMs = useMemo(() => {
    void tick;
    return Date.now();
  }, [tick]);

  const statusChip = useMemo(() => {
    const wall = nowMs;
    if (pollError && !snapshot)
      return { label: pollError, tone: "bad" as const };
    if (lastPollOkAt && wall - lastPollOkAt > 20_000)
      return { label: "Polling stalled", tone: "bad" as const };
    if (!sortedPorts.length)
      return { label: "No antenna rows yet", tone: "warn" as const };
    if (newestLastSeenMs !== null && wall - newestLastSeenMs > 45_000) {
      return { label: "No recent reads", tone: "warn" as const };
    }
    if (stream.status !== "live") {
      return { label: "Connecting stream", tone: "warn" as const };
    }
    return { label: "Live stream", tone: "live" as const };
  }, [
    pollError,
    snapshot,
    lastPollOkAt,
    sortedPorts.length,
    newestLastSeenMs,
    nowMs,
    stream.status,
  ]);

  const chartSeries = useMemo(() => {
    const rows: Array<{
      kind: "mac" | "antenna";
      mac: string;
      port?: string;
      label: string;
      color: string;
      linewidth: number;
      trend: boolean;
    }> = [];
    const portsByMac = new Map<string, string[]>();
    for (const p of sortedPorts) {
      const mac = p.mac.toUpperCase();
      const arr = portsByMac.get(mac) ?? [];
      arr.push(String(p.port));
      portsByMac.set(mac, arr);
    }
    for (const [mac, ports] of portsByMac) {
      const idx = macIndex.get(mac) ?? 0;
      const base = MAC_BASE_PALETTE_RGB[idx % MAC_BASE_PALETTE_RGB.length];
      if (macsOn[mac] ?? true) {
        rows.push({
          kind: "mac",
          mac,
          label: displayMac(mac),
          color: rgbToHex([base[0], base[1], base[2]]),
          linewidth: 2.2,
          trend: true,
        });
      }
      const sorted = [...new Set(ports)].sort((a, b) => {
        const ka = portSortKey(a);
        const kb = portSortKey(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        return String(ka[1]).localeCompare(String(kb[1]));
      });
      sorted.forEach((port, i) => {
        const key = `${mac}:${port}`;
        if (!(antsOn[key] ?? true)) return;
        const shade = antennaShade([base[0], base[1], base[2]], i, sorted.length);
        rows.push({
          kind: "antenna",
          mac,
          port,
          label: `${displayMac(mac)} · Ant ${port}`,
          color: rgbToHex(shade),
          linewidth: 1.2,
          trend: false,
        });
      });
    }
    return rows;
  }, [sortedPorts, macIndex, macsOn, antsOn, displayMac]);

  const macRgb = useCallback(
    (mac: string): [number, number, number] => {
      const idx = macIndex.get(mac.toUpperCase()) ?? 0;
      const p = MAC_BASE_PALETTE_RGB[idx % MAC_BASE_PALETTE_RGB.length];
      return [p[0], p[1], p[2]];
    },
    [macIndex],
  );

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(
      `/api/events/${encodeURIComponent(shortId)}/unlock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      },
    );
    if (!r.ok) {
      toast({ title: "Invalid password", variant: "destructive" });
      return;
    }
    setPassword("");
    await loadSnapshot();
  }

  if (gate === "checking") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted">
        Checking access…
      </div>
    );
  }

  if (gate === "login") {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-lg">
        <h1 className="text-lg font-semibold">Viewer login</h1>
        <p className="text-sm text-muted">
          Enter the password shared by your timer for event{" "}
          <code className="text-foreground">{shortId}</code>.
        </p>
        <form onSubmit={onUnlock} className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="Password"
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="rounded bg-foreground px-3 py-2 text-sm font-medium text-background"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>{pollError ?? "Could not load event data."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {eventTitle || "Live event"}
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${
              statusChip.tone === "live"
                ? "bg-emerald-500/15 text-emerald-400"
                : statusChip.tone === "warn"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-rose-500/15 text-rose-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                statusChip.tone === "live"
                  ? "bg-emerald-400"
                  : statusChip.tone === "warn"
                    ? "bg-amber-400"
                    : "bg-rose-400"
              }`}
            />
            {statusChip.label}
          </span>
        </div>
        <p className="text-xs text-muted">
          {shortId}
          {lastPollOkAt ? (
            <>
              {" "}
              · Updated{" "}
              {new Date(lastPollOkAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}{" "}
              · Next poll in ~{Math.round(POLL_MS / 1000)}s
            </>
          ) : null}
        </p>
        {pollError ? (
          <p className="text-xs text-amber-400">{pollError}</p>
        ) : null}
      </header>

      <p className="text-sm text-muted">
        Layout mirrors the timer workspace payload when available; stream mode
        keeps activity smooth while totals remain DB-backed.
      </p>

      {snapshot && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px,1fr]">
          <FilterPanel
            snapshot={snapshot}
            macsOn={macsOn}
            antsOn={antsOn}
            onMac={(mac, v) => setMacsOn((p) => ({ ...p, [mac]: v }))}
            onAnt={(mac, port, v) =>
              setAntsOn((p) => ({ ...p, [`${mac}:${port}`]: v }))
            }
            buffersWall={buffersWall}
          />
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-muted">Workspace</label>
              <select
                className="rounded border border-border bg-background px-2 py-1 text-sm"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.payload.name || w.workspaceId}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">
                {stream.status === "live"
                  ? "SSE live"
                  : `Polling fallback ~${Math.round(POLL_MS / 1000)}s`}
              </span>
            </div>
            {activeWorkspace?.view === "heatmap" && slots.length > 0 ? (
              <HeatmapCanvas
                buffers={stream.buffers}
                slots={slots}
                macRgb={macRgb}
                displayMac={displayMac}
                portTotals={portTotals}
                lastSeenWall={lastSeenWall}
              />
            ) : (
              <LiveChart
                buffers={stream.buffers}
                series={chartSeries}
                gateLabel={snapshot.gateTime ?? undefined}
              />
            )}
          </div>
        </div>
      )}

      {sortedPorts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/40 px-4 py-8 text-center text-muted">
          No per-antenna rows yet. When the timer publishes reads, they will
          appear here grouped by MAC and port.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedPorts.map((p) => {
            const border = macHex(p.mac);
            return (
              <div
                key={`${p.mac}:${p.port}`}
                className="flex min-h-[200px] flex-col rounded-xl border-2 bg-card/60 p-4 shadow-sm"
                style={{ borderColor: border }}
              >
                <div
                  className="mb-2 h-1 w-10 rounded-full"
                  style={{ backgroundColor: border }}
                />
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  MAC · Antenna
                </div>
                <div className="truncate text-sm font-semibold leading-snug">
                  {displayMac(p.mac)}
                </div>
                <div className="text-base font-medium text-foreground">
                  Ant {p.port}
                </div>
                <div className="mt-3 flex flex-1 flex-col justify-center border-y border-border/60 py-4">
                  <div className="text-4xl font-bold tabular-nums tracking-tight">
                    {Number(p.totalReads).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted">reads (all time)</div>
                </div>
                <div className="mt-auto space-y-1 pt-3">
                  <div className="text-[11px] font-medium uppercase text-muted">
                    Last read
                  </div>
                  <div className="font-mono text-xs leading-relaxed text-foreground">
                    {formatClock(p.lastSeen)}
                  </div>
                  <div className="text-sm text-muted">
                    {formatRelative(p.lastSeen, nowMs)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
