export type HeatmapSlotState = {
  role: "row1" | "row2" | "left" | "right";
  col: number;
  row: number;
  mac?: string | null;
  port?: string | null;
};

export type WorkspacePayload = {
  name: string;
  view: "chart" | "heatmap";
  macs: Record<string, boolean>;
  antennas: Record<string, boolean>;
  heatmap?: {
    row1: number;
    row2: number;
    left: number;
    right: number;
    slots: HeatmapSlotState[];
  };
};
