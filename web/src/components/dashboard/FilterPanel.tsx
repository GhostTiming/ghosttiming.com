"use client";

import { useMemo } from "react";
import type { SnapshotApi } from "@/types/snapshot";
import { cn } from "@/lib/utils";
import {
  antennaShade,
  MAC_BASE_PALETTE_RGB,
  portSortKey,
  rgbToHex,
} from "@/lib/colors";

type Props = {
  snapshot: SnapshotApi;
  macsOn: Record<string, boolean>;
  antsOn: Record<string, boolean>;
  onMac: (mac: string, v: boolean) => void;
  onAnt: (mac: string, port: string, v: boolean) => void;
  readonly?: boolean;
  buffersWall: Map<string, Map<string, number>>;
};

export function FilterPanel({
  snapshot,
  macsOn,
  antsOn,
  onMac,
  onAnt,
  readonly,
  buffersWall,
}: Props) {
  const orderedMacs = useMemo(
    () =>
      [...snapshot.macs].sort((a, b) => a.mac.localeCompare(b.mac)).map((m) => m.mac),
    [snapshot.macs],
  );

  const macIndex = useMemo(() => {
    const m = new Map<string, number>();
    orderedMacs.forEach((mac, i) => m.set(mac, i));
    return m;
  }, [orderedMacs]);

  const friendly = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of snapshot.macs) {
      if (row.friendlyName)
        m.set(row.mac.toUpperCase(), row.friendlyName);
    }
    return m;
  }, [snapshot.macs]);

  function displayMac(mac: string) {
    const fn = friendly.get(mac.toUpperCase());
    return fn ? `${mac} (${fn})` : mac;
  }

  function macBaseRgb(mac: string): [number, number, number] {
    const idx = macIndex.get(mac.toUpperCase()) ?? 0;
    const pal = MAC_BASE_PALETTE_RGB[idx % MAC_BASE_PALETTE_RGB.length];
    return [pal[0], pal[1], pal[2]];
  }

  function elapsedLabel(mac: string, port?: string): string {
    const mm = buffersWall.get(mac.toUpperCase());
    if (!mm || mm.size === 0) return "last read: —";
    if (port !== undefined) {
      const t = mm.get(String(port));
      if (t === undefined) return "last read: —";
      const sec = (Date.now() - t) / 1000;
      return `last read: ${sec < 90 ? `${sec.toFixed(1)}s ago` : `${Math.floor(sec / 60)}m ago`}`;
    }
    const last = Math.max(...mm.values());
    const sec = (Date.now() - last) / 1000;
    return `last read: ${sec < 90 ? `${sec.toFixed(1)}s ago` : `${Math.floor(sec / 60)}m ago`}`;
  }

  function portsFor(mac: string): string[] {
    const ports = snapshot.ports
      .filter((p) => p.mac === mac)
      .map((p) => String(p.port));
    const uniq = [...new Set(ports)].sort((a, b) => {
      const ka = portSortKey(a);
      const kb = portSortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      return String(ka[1]).localeCompare(String(kb[1]));
    });
    return uniq;
  }

  function setAll(on: boolean) {
    for (const mac of orderedMacs) {
      onMac(mac, on);
      for (const port of portsFor(mac)) {
        onAnt(mac, port, on);
      }
    }
  }

  function macsOnly(macs: boolean) {
    for (const mac of orderedMacs) {
      onMac(mac, macs);
      for (const port of portsFor(mac)) {
        onAnt(mac, port, !macs);
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={readonly}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-background"
          onClick={() => setAll(true)}
        >
          All
        </button>
        <button
          type="button"
          disabled={readonly}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-background"
          onClick={() => setAll(false)}
        >
          None
        </button>
        <button
          type="button"
          disabled={readonly}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-background"
          onClick={() => macsOnly(true)}
        >
          MACs only
        </button>
        <button
          type="button"
          disabled={readonly}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-background"
          onClick={() => macsOnly(false)}
        >
          Ants only
        </button>
      </div>

      <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
        {orderedMacs.map((mac) => {
          const baseRgb = macBaseRgb(mac);
          const ants = portsFor(mac);
          return (
            <div key={mac} className="border-b border-border pb-3 last:border-0">
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2",
                  readonly && "opacity-80",
                )}
              >
                <span
                  className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: rgbToHex([
                      baseRgb[0],
                      baseRgb[1],
                      baseRgb[2],
                    ]),
                  }}
                />
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={macsOn[mac] ?? true}
                  disabled={readonly}
                  onChange={(e) => onMac(mac, e.target.checked)}
                />
                <span className="text-sm font-medium leading-tight">
                  {displayMac(mac)}
                </span>
              </label>
              <div className="ml-7 mt-1 text-[11px] text-muted">
                {elapsedLabel(mac)}
              </div>
              <div className="ml-6 mt-2 space-y-3 border-l border-border pl-3">
                {ants.map((port, pi) => {
                  const shade = antennaShade(baseRgb, pi, Math.max(1, ants.length));
                  const key = `${mac}:${port}`;
                  return (
                    <div key={key}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-2",
                          readonly && "opacity-80",
                        )}
                      >
                        <span
                          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{
                            backgroundColor: rgbToHex(shade),
                          }}
                        />
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={antsOn[key] ?? true}
                          disabled={readonly}
                          onChange={(e) => onAnt(mac, port, e.target.checked)}
                        />
                        <span className="text-xs">Ant {port}</span>
                      </label>
                      <div className="ml-8 text-[11px] text-muted">
                        {elapsedLabel(mac, port)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
