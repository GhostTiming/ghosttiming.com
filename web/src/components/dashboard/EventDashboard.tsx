"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEventStream } from "@/hooks/use-event-stream";
import { useToast } from "@/hooks/use-toast";
import { LiveChart, type SeriesSpec } from "@/components/dashboard/LiveChart";
import { HeatmapCanvas } from "@/components/dashboard/HeatmapCanvas";
import {
  antennaShade,
  MAC_BASE_PALETTE_RGB,
  portSortKey,
  rgbToHex,
} from "@/lib/colors";
import {
  autoWorkspaceFromSnapshot,
  countFilledSlots,
  parseWorkspacePayload,
  rebuildHeatmapSlots,
} from "@/lib/workspace";
import type { SnapshotApi } from "@/types/snapshot";

type Gate = "checking" | "login" | "live";

/**
 * Viewer dashboard.
 *
 * Deliberately minimal: no controls, no tabs, no filter editing. Viewers see
 * a read-only mirror of the timer's published workspace (or an auto-generated
 * fallback when nothing has been published yet).
 */
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
    (batch: Array<{ id: string; mac: string; port: number; ts: string }>) => {
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

  const { snapshot, buffers, status, reconnects, lastReadAt, applySnapshot } =
    useEventStream(shortId, gate === "live", onReads);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(
        `/api/events/${encodeURIComponent(shortId)}/snapshot`,
        { credentials: "include" },
      );
      if (cancelled) return;
      if (r.ok) {
        try {
          const body = (await r.json()) as SnapshotApi;
          applySnapshot(body);
        } catch {
          /* fall through to SSE */
        }
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
  }, [shortId, toast, applySnapshot]);

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

  /** Auto-generated workspace when the timer hasn't published one yet. */
  const autoPayload = useMemo(
    () => (snapshot ? autoWorkspaceFromSnapshot(snapshot) : null),
    [snapshot],
  );

  /**
   * Single source of truth for what's on screen: the timer's first published
   * workspace, or the auto layout if the timer hasn't published / the
   * published one is empty.
   */
  const effective = useMemo(() => {
    if (!snapshot) return null;
    if (snapshot.workspaces?.length) {
      const row = snapshot.workspaces[0];
      const parsed = parseWorkspacePayload(row.payload);
      if (countFilledSlots(parsed) === 0 && autoPayload) {
        return autoPayload;
      }
      return parsed;
    }
    return autoPayload;
  }, [snapshot, autoPayload]);

  const macsOn = useMemo(() => effective?.macs ?? {}, [effective?.macs]);
  const antsOn = useMemo(
    () => effective?.antennas ?? {},
    [effective?.antennas],
  );

  // Connection chip: Live / Connecting / Reconnecting / No reads in 30 s.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (gate !== "live") return;
    const iv = setInterval(() => setNowTick(Date.now()), 2000);
    return () => clearInterval(iv);
  }, [gate]);

  type ConnChip = { label: string; tone: "live" | "warn" | "bad" };
  const connChip: ConnChip = useMemo(() => {
    if (status === "error") return { label: "Reconnecting\u2026", tone: "bad" };
    if (status === "connecting")
      return { label: "Connecting\u2026", tone: "warn" };
    if (
      lastReadAt !== null &&
      nowTick - lastReadAt > 30_000 &&
      snapshot &&
      snapshot.macs.length > 0
    ) {
      return { label: "No reads in last 30 s", tone: "warn" };
    }
    return { label: "Live", tone: "live" };
  }, [status, lastReadAt, nowTick, snapshot]);

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
        label: `${displayMac(mac)} \u00b7 Ant ${port}`,
        color: rgbToHex(shade),
        linewidth: 1.2,
        trend: false,
      });
    }
    return specs;
  }, [snapshot, orderedMacs, macsOn, antsOn, displayMac, macRgb]);

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

  const view = effective?.view ?? "heatmap";

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {eventTitle || "Live event"}
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${
              connChip.tone === "live"
                ? "bg-emerald-500/15 text-emerald-400"
                : connChip.tone === "warn"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-rose-500/15 text-rose-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connChip.tone === "live"
                  ? "bg-emerald-400"
                  : connChip.tone === "warn"
                    ? "bg-amber-400"
                    : "bg-rose-400"
              }`}
            />
            {connChip.label}
          </span>
        </div>
        <p className="text-xs text-muted">
          {shortId}
          {reconnects > 0 ? ` · r${reconnects}` : ""}
        </p>
      </header>

      <main className="min-w-0">
        {view === "heatmap" ? (
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
  );
}
