"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEventStream } from "@/hooks/use-event-stream";
import { useToast } from "@/hooks/use-toast";
import { LiveChart, type SeriesSpec } from "@/components/dashboard/LiveChart";
import { FilterPanel } from "@/components/dashboard/FilterPanel";
import { HeatmapCanvas } from "@/components/dashboard/HeatmapCanvas";
import {
  antennaShade,
  MAC_BASE_PALETTE_RGB,
  portSortKey,
  rgbToHex,
} from "@/lib/colors";
import {
  autoWorkspaceFromSnapshot,
  defaultWorkspace,
  parseWorkspacePayload,
  rebuildHeatmapSlots,
} from "@/lib/workspace";
import type { WorkspacePayload } from "@/types/workspace";

const LS_PERSONAL = (shortId: string) => `cs:${shortId}:personal_v1`;

type Gate = "checking" | "login" | "live";

export function EventDashboard({ shortId }: { shortId: string }) {
  const toast = useToast();
  const [gate, setGate] = useState<Gate>("checking");
  const [password, setPassword] = useState("");
  const [eventTitle, setEventTitle] = useState("");

  const [portTotals, setPortTotals] = useState(() => new Map<string, number>());
  const [lastSeenWall, setLastSeenWall] = useState(
    () => new Map<string, number>(),
  );

  const onReads = useCallback(
    (
      batch: Array<{ id: string; mac: string; port: number; ts: string }>,
    ) => {
      setPortTotals((prev) => {
        const n = new Map(prev);
        for (const r of batch) {
          const k = `${r.mac.toUpperCase()}:${r.port}`;
          n.set(k, (n.get(k) ?? 0) + 1);
        }
        return n;
      });
      setLastSeenWall((prev) => {
        const n = new Map(prev);
        for (const r of batch) {
          const k = `${r.mac.toUpperCase()}:${r.port}`;
          n.set(k, new Date(r.ts).getTime());
        }
        return n;
      });
    },
    [],
  );

  const { snapshot, buffers, status, reconnects } = useEventStream(
    shortId,
    gate === "live",
    onReads,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(
        `/api/events/${encodeURIComponent(shortId)}/snapshot`,
        { credentials: "include" },
      );
      if (cancelled) return;
      if (r.ok) {
        setGate("live");
      } else if (r.status === 401) {
        setGate("login");
      } else if (r.status === 410) {
        toast({
          title: "This event is closed.",
          variant: "destructive",
        });
        setGate("login");
      } else {
        toast({ title: "Could not load event.", variant: "destructive" });
        setGate("login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shortId, toast]);

  useEffect(() => {
    if (snapshot?.name) setEventTitle(snapshot.name);
  }, [snapshot?.name]);

  useEffect(() => {
    if (!snapshot) return;
    const pt = new Map<string, number>();
    const ls = new Map<string, number>();
    for (const p of snapshot.ports) {
      const k = `${p.mac.toUpperCase()}:${p.port}`;
      pt.set(k, p.totalReads);
      ls.set(k, new Date(p.lastSeen).getTime());
    }
    setPortTotals(pt);
    setLastSeenWall(ls);
  }, [snapshot]);

  const orderedMacs = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.macs]
      .sort((a, b) => a.mac.localeCompare(b.mac))
      .map((m) => m.mac.toUpperCase());
  }, [snapshot]);

  const macIndex = useMemo(() => {
    const m = new Map<string, number>();
    orderedMacs.forEach((mac, i) => m.set(mac, i));
    return m;
  }, [orderedMacs]);

  const friendly = useMemo(() => {
    const m = new Map<string, string>();
    if (!snapshot) return m;
    for (const row of snapshot.macs) {
      if (row.friendlyName) m.set(row.mac.toUpperCase(), row.friendlyName);
    }
    return m;
  }, [snapshot]);

  const displayMac = useCallback(
    (mac: string) => {
      const fn = friendly.get(mac.toUpperCase());
      return fn ? `${mac} (${fn})` : mac;
    },
    [friendly],
  );

  const macRgb = useCallback(
    (mac: string): [number, number, number] => {
      const idx = macIndex.get(mac.toUpperCase()) ?? 0;
      const p = MAC_BASE_PALETTE_RGB[idx % MAC_BASE_PALETTE_RGB.length];
      return [p[0], p[1], p[2]];
    },
    [macIndex],
  );

  const [personal, setPersonal] = useState<WorkspacePayload>(() =>
    defaultWorkspace(),
  );
  /** Default to timer “Shared layout” so heatmap/chart match the desktop publish. */
  const [activeTab, setActiveTab] = useState<"shared" | "personal">("shared");
  const [sharedId, setSharedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PERSONAL(shortId));
      if (raw) setPersonal(parseWorkspacePayload(JSON.parse(raw)));
    } catch {
      /* keep default */
    }
  }, [shortId]);

  useEffect(() => {
    if (!personal) return;
    try {
      localStorage.setItem(LS_PERSONAL(shortId), JSON.stringify(personal));
    } catch {
      /* quota */
    }
  }, [shortId, personal]);

  const autoSharedPayload = useMemo(
    () => (snapshot ? autoWorkspaceFromSnapshot(snapshot) : null),
    [snapshot],
  );

  useEffect(() => {
    if (!snapshot?.workspaces?.length) return;
    const first = snapshot.workspaces[0]?.workspaceId;
    if (first && !sharedId) setSharedId(first);
  }, [snapshot?.workspaces, sharedId]);

  const sharedPayload = useMemo(() => {
    if (!snapshot) return null;
    if (snapshot.workspaces?.length) {
      const id = sharedId ?? snapshot.workspaces[0].workspaceId;
      const row = snapshot.workspaces.find((w) => w.workspaceId === id);
      return row ? parseWorkspacePayload(row.payload) : null;
    }
    return autoSharedPayload;
  }, [snapshot, sharedId, autoSharedPayload]);

  const hasTimerLayouts = (snapshot?.workspaces?.length ?? 0) > 0;

  const effective = useMemo(() => {
    if (activeTab === "shared" && sharedPayload) return sharedPayload;
    return personal;
  }, [activeTab, sharedPayload, personal]);
  const readonlyFilters = activeTab === "shared";

  const macsOn = useMemo(
    () => effective?.macs ?? {},
    [effective?.macs],
  );
  const antsOn = useMemo(
    () => effective?.antennas ?? {},
    [effective?.antennas],
  );

  const setMac = useCallback(
    (mac: string, v: boolean) => {
      if (readonlyFilters) return;
      setPersonal((prev) => ({
        ...prev,
        macs: { ...prev.macs, [mac]: v },
      }));
    },
    [readonlyFilters],
  );

  const setAnt = useCallback(
    (mac: string, port: string, v: boolean) => {
      if (readonlyFilters) return;
      const key = `${mac}:${port}`;
      setPersonal((prev) => ({
        ...prev,
        antennas: { ...prev.antennas, [key]: v },
      }));
    },
    [readonlyFilters],
  );

  const chartSeries: SeriesSpec[] = useMemo(() => {
    if (!snapshot) return [];
    const specs: SeriesSpec[] = [];
    for (const mac of orderedMacs) {
      if (!(macsOn[mac] ?? true)) continue;
      const rgb = macRgb(mac);
      specs.push({
        kind: "mac",
        mac,
        label: displayMac(mac),
        color: rgbToHex(rgb),
        linewidth: 2,
        trend: true,
      });
    }
    const antDone = new Set<string>();
    for (const pr of snapshot.ports) {
      const mac = pr.mac.toUpperCase();
      const port = String(pr.port);
      const key = `${mac}:${port}`;
      if (antDone.has(key)) continue;
      antDone.add(key);
      if (!(antsOn[key] ?? true)) continue;
      const ports = snapshot.ports
        .filter((p) => p.mac === mac)
        .map((p) => String(p.port));
      const uniq = [...new Set(ports)].sort((a, b) => {
        const ka = portSortKey(a);
        const kb = portSortKey(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        return String(ka[1]).localeCompare(String(kb[1]));
      });
      const pi = Math.max(0, uniq.indexOf(port));
      const shade = antennaShade(macRgb(mac), pi, Math.max(1, uniq.length));
      specs.push({
        kind: "antenna",
        mac,
        port,
        label: `${displayMac(mac)} · Ant ${port}`,
        color: rgbToHex(shade),
        linewidth: 1.2,
        trend: false,
      });
    }
    return specs;
  }, [snapshot, orderedMacs, macsOn, antsOn, displayMac, macRgb]);

  const buffersWall = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const [k, t] of lastSeenWall) {
      const [mac, port] = k.split(":");
      if (!m.has(mac)) m.set(mac, new Map());
      m.get(mac)!.set(port, t);
    }
    return m;
  }, [lastSeenWall]);

  const heatmapSlots = useMemo(() => {
    if (!effective?.heatmap) return [];
    const h = effective.heatmap;
    return rebuildHeatmapSlots(h.row1, h.row2, h.left, h.right, h.slots);
  }, [effective?.heatmap]);

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
    setGate("live");
    setPassword("");
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
      <div className="space-y-2">
        <div className="text-sm text-muted">
          Connection: {status}
          {reconnects > 0 ? ` · reconnect #${reconnects}` : ""}
        </div>
        <div>Waiting for live data…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {eventTitle || "Live event"}
          </h1>
          <p className="text-xs text-muted">
            {shortId} · SSE {status}
            {reconnects > 0 ? ` · r${reconnects}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasTimerLayouts ? (
            <select
              className="rounded border border-border bg-card px-2 py-1 text-sm"
              value={sharedId ?? ""}
              onChange={(e) => setSharedId(e.target.value || null)}
            >
              {(snapshot.workspaces ?? []).map((w) => (
                <option key={w.workspaceId} value={w.workspaceId}>
                  Timer: {parseWorkspacePayload(w.payload).name}
                </option>
              ))}
            </select>
          ) : autoSharedPayload ? (
            <span className="rounded border border-border bg-card px-2 py-1 text-sm text-muted">
              Live feeds (auto)
            </span>
          ) : (
            <span className="rounded border border-border bg-muted/30 px-2 py-1 text-sm text-muted">
              No timer layout — publishing reads only
            </span>
          )}
          <div className="flex gap-1 rounded border border-border p-0.5">
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs ${
                activeTab === "shared"
                  ? "bg-foreground text-background"
                  : "hover:bg-background"
              }`}
              onClick={() => setActiveTab("shared")}
              disabled={!hasTimerLayouts && !autoSharedPayload}
            >
              Shared layout
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs ${
                activeTab === "personal"
                  ? "bg-foreground text-background"
                  : "hover:bg-background"
              }`}
              onClick={() => setActiveTab("personal")}
            >
              My layout
            </button>
          </div>
          {activeTab === "personal" && (
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs"
                  onClick={() => {
                if (sharedPayload) {
                  setPersonal(
                    JSON.parse(JSON.stringify(sharedPayload)) as WorkspacePayload,
                  );
                  toast({ title: "Copied timer layout to My layout." });
                }
              }}
            >
              Copy from timer
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-[300px]">
          <FilterPanel
            snapshot={snapshot}
            macsOn={macsOn}
            antsOn={antsOn}
            onMac={setMac}
            onAnt={setAnt}
            readonly={readonlyFilters}
            buffersWall={buffersWall}
          />
        </aside>
        <main className="min-w-0 flex-1 space-y-4">
          <div className="flex gap-2 text-sm">
            <span className="text-muted">View:</span>
            {activeTab === "personal" ? (
              <>
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 ${
                    effective?.view === "chart"
                      ? "bg-foreground text-background"
                      : ""
                  }`}
                  onClick={() =>
                    setPersonal((p) => ({ ...p, view: "chart" }))
                  }
                >
                  Chart
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 ${
                    effective?.view === "heatmap"
                      ? "bg-foreground text-background"
                      : ""
                  }`}
                  onClick={() =>
                    setPersonal((p) => ({ ...p, view: "heatmap" }))
                  }
                >
                  Heatmap
                </button>
              </>
            ) : (
              <span className="capitalize">{effective?.view ?? "chart"}</span>
            )}
          </div>

          {effective?.view === "heatmap" ? (
            <HeatmapCanvas
              buffers={buffers}
              slots={heatmapSlots}
              macRgb={macRgb}
              displayMac={displayMac}
              portTotals={portTotals}
              lastSeenWall={lastSeenWall}
            />
          ) : (
            <LiveChart
              buffers={buffers}
              series={chartSeries}
              gateLabel={snapshot.gateTime ?? undefined}
            />
          )}
        </main>
      </div>
    </div>
  );
}
