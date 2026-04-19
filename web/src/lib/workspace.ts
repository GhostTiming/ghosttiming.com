import type { SnapshotApi } from "@/types/snapshot";
import type { HeatmapSlotState, WorkspacePayload } from "@/types/workspace";

export function defaultWorkspace(name = "My view"): WorkspacePayload {
  return {
    name,
    view: "chart",
    macs: {},
    antennas: {},
    heatmap: {
      row1: 4,
      row2: 0,
      left: 0,
      right: 0,
      slots: [],
    },
  };
}

export function parseWorkspacePayload(raw: unknown): WorkspacePayload {
  if (!raw || typeof raw !== "object") return defaultWorkspace();
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "Workspace";
  const view = o.view === "heatmap" ? "heatmap" : "chart";
  const macs =
    o.macs && typeof o.macs === "object"
      ? (o.macs as Record<string, boolean>)
      : {};
  const antennas =
    o.antennas && typeof o.antennas === "object"
      ? (o.antennas as Record<string, boolean>)
      : {};
  let heatmap = defaultWorkspace().heatmap!;
  if (o.heatmap && typeof o.heatmap === "object") {
    const h = o.heatmap as Record<string, unknown>;
    heatmap = {
      row1: typeof h.row1 === "number" ? h.row1 : 4,
      row2: typeof h.row2 === "number" ? h.row2 : 0,
      left: typeof h.left === "number" ? h.left : 0,
      right: typeof h.right === "number" ? h.right : 0,
      slots: Array.isArray(h.slots)
        ? (h.slots as HeatmapSlotState[])
        : [],
    };
  }
  return { name, view, macs, antennas, heatmap };
}

/** Same slot ordering as desktop HeatmapView._rebuild_slots */
export function rebuildHeatmapSlots(
  row1: number,
  row2: number,
  left: number,
  right: number,
  saved: HeatmapSlotState[] | undefined,
): HeatmapSlotState[] {
  const old = new Map<string, HeatmapSlotState>();
  for (const s of saved ?? []) {
    old.set(`${s.role}:${s.col}:${s.row}`, { ...s });
  }
  const out: HeatmapSlotState[] = [];

  function carry(role: HeatmapSlotState["role"], col: number, row: number) {
    const prev = old.get(`${role}:${col}:${row}`);
    out.push({
      role,
      col,
      row,
      mac: prev?.mac ?? null,
      port: prev?.port ?? null,
    });
  }

  for (let c = 0; c < left; c++) carry("left", c, 0);
  for (let c = 0; c < row1; c++) carry("row1", c, 0);
  for (let c = 0; c < row2; c++) carry("row2", c, 1);
  for (let c = 0; c < right; c++) carry("right", c, 0);
  return out;
}

/**
 * When the desktop has not published Analytics workspaces yet, derive a heatmap
 * from live port / read data so remote viewers still see mats and activity.
 */
export function autoWorkspaceFromSnapshot(
  snapshot: SnapshotApi,
): WorkspacePayload | null {
  const keys = new Set<string>();
  for (const p of snapshot.ports) {
    keys.add(`${p.mac.toUpperCase()}:${p.port}`);
  }
  if (keys.size === 0) {
    for (const r of snapshot.recentReads.slice(-800)) {
      keys.add(`${r.mac.toUpperCase()}:${r.port}`);
    }
  }
  const uniq = [...keys].sort((a, b) => a.localeCompare(b));
  if (uniq.length === 0) {
    return null;
  }

  const macs: Record<string, boolean> = {};
  const antennas: Record<string, boolean> = {};
  for (const k of uniq) {
    antennas[k] = true;
    const m = k.split(":")[0] ?? "";
    if (m) macs[m] = true;
  }

  const row1 = 4;
  const slots: HeatmapSlotState[] = [];
  for (let c = 0; c < row1; c++) {
    const key = uniq[c];
    let mac: string | null = null;
    let port: string | null = null;
    if (key) {
      const parts = key.split(":");
      mac = parts[0] ?? null;
      port = parts.slice(1).join(":") || null;
    }
    slots.push({
      role: "row1",
      col: c,
      row: 0,
      mac,
      port,
    });
  }

  return {
    name: "Live feeds",
    view: "heatmap",
    macs,
    antennas,
    heatmap: {
      row1,
      row2: 0,
      left: 0,
      right: 0,
      slots: rebuildHeatmapSlots(row1, 0, 0, 0, slots),
    },
  };
}
