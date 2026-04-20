"use client";

import type { HeatmapSlotState } from "@/types/workspace";

type Props = {
  slots: HeatmapSlotState[];
  macRgb: (mac: string) => [number, number, number];
  displayMac: (mac: string) => string;
  portTotals: Map<string, number>;
  lastSeenWall: Map<string, number>;
  nowMs: number;
};

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 90) return `${s}s ago`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s ago`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m ago`;
}

function slotBg(
  mac: string | null,
  port: string | null,
  macRgb: (mac: string) => [number, number, number],
  lastSeenWall: Map<string, number>,
  nowMs: number,
): string {
  const base: [number, number, number] = [0.09, 0.1, 0.13];
  if (!mac || !port) {
    return `rgb(${Math.round(base[0] * 255)}, ${Math.round(base[1] * 255)}, ${Math.round(base[2] * 255)})`;
  }
  const key = `${mac}:${port}`;
  const t = lastSeenWall.get(key);
  const ageSecRaw = t ? (nowMs - t) / 1000 : 9_999;
  const ageSec = Math.floor(ageSecRaw / 5) * 5;
  const freshness = clamp01(1 - ageSec / 300);
  const target = macRgb(mac);
  const mix = 0.18 + 0.72 * freshness;
  const r = base[0] + mix * (target[0] - base[0]);
  const g = base[1] + mix * (target[1] - base[1]);
  const b = base[2] + mix * (target[2] - base[2]);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function StableHeatmap({
  slots,
  macRgb,
  displayMac,
  portTotals,
  lastSeenWall,
  nowMs,
}: Props) {
  const left = slots.filter((s) => s.role === "left");
  const row1 = slots.filter((s) => s.role === "row1");
  const row2 = slots.filter((s) => s.role === "row2");
  const right = slots.filter((s) => s.role === "right");
  const rows = [row1, row2].filter((r) => r.length > 0);

  return (
    <div className="rounded-lg border border-border bg-[#111218] p-3">
      <div className="grid grid-cols-[auto,1fr,auto] gap-3">
        <div className="flex gap-2">
          {left.map((s) => (
            <SlotCard
              key={`${s.role}:${s.col}:${s.row}`}
              slot={s}
              macRgb={macRgb}
              displayMac={displayMac}
              portTotals={portTotals}
              lastSeenWall={lastSeenWall}
              nowMs={nowMs}
              side
            />
          ))}
        </div>
        <div className="space-y-2">
          {rows.map((r, idx) => (
            <div key={idx} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${r.length}, minmax(0, 1fr))` }}>
              {r.map((s) => (
                <SlotCard
                  key={`${s.role}:${s.col}:${s.row}`}
                  slot={s}
                  macRgb={macRgb}
                  displayMac={displayMac}
                  portTotals={portTotals}
                  lastSeenWall={lastSeenWall}
                  nowMs={nowMs}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {right.map((s) => (
            <SlotCard
              key={`${s.role}:${s.col}:${s.row}`}
              slot={s}
              macRgb={macRgb}
              displayMac={displayMac}
              portTotals={portTotals}
              lastSeenWall={lastSeenWall}
              nowMs={nowMs}
              side
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  macRgb,
  displayMac,
  portTotals,
  lastSeenWall,
  nowMs,
  side = false,
}: {
  slot: HeatmapSlotState;
  macRgb: (mac: string) => [number, number, number];
  displayMac: (mac: string) => string;
  portTotals: Map<string, number>;
  lastSeenWall: Map<string, number>;
  nowMs: number;
  side?: boolean;
}) {
  const mac = slot.mac ?? null;
  const port = slot.port ?? null;
  const key = mac && port ? `${mac}:${port}` : "";
  const lastSeen = key ? lastSeenWall.get(key) : undefined;
  const total = key ? portTotals.get(key) ?? 0 : 0;
  const elapsed = lastSeen ? formatElapsed((nowMs - lastSeen) / 1000) : "no reads yet";

  return (
    <div
      className={`rounded border border-white/10 p-2 text-center ${side ? "w-20" : "min-h-[150px]"}`}
      style={{ background: slotBg(mac, port, macRgb, lastSeenWall, nowMs) }}
    >
      <div className="text-[11px] text-white/90">
        {mac && port ? `${displayMac(mac)} · Ant ${port}` : "Unassigned"}
      </div>
      <div className="mt-2 text-3xl font-bold text-white">{total.toLocaleString()}</div>
      <div className="text-[11px] text-white/80">reads</div>
      <div className="mt-2 text-[11px] text-white/70">{elapsed}</div>
    </div>
  );
}

