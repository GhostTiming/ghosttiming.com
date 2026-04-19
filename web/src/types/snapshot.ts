export type SnapshotApi = {
  eventId: string;
  shortId: string;
  name: string;
  gateTime: string | null;
  macs: Array<{
    mac: string;
    friendlyName: string | null;
    firstSeen: string;
    lastSeen: string;
    totalReads: number;
  }>;
  ports: Array<{
    mac: string;
    port: number;
    lastSeen: string;
    totalReads: number;
  }>;
  workspaces: Array<{
    workspaceId: string;
    payload: unknown;
    updatedAt: string;
  }>;
  recentReads: Array<{
    id: string;
    mac: string;
    port: number;
    ts: string;
  }>;
};
