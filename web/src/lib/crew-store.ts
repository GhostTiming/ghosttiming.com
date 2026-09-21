import { list, put } from "@vercel/blob";

const INDEX_PATH = "cs-live/gtw8f41/index.json";

function snapshotPath(eventId: string): string {
  return `cs-live/gtw8f41/${eventId}.json`;
}

async function readJson(pathname: string): Promise<unknown | null> {
  const result = await list({ prefix: pathname, limit: 10 });
  const blob = result.blobs.find((item) => item.pathname === pathname);
  if (!blob) return null;
  const res = await fetch(blob.downloadUrl, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function writeJson(pathname: string, payload: unknown): Promise<void> {
  await put(pathname, JSON.stringify(payload), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function readCrewIndex(): Promise<unknown | null> {
  return readJson(INDEX_PATH);
}

export async function writeCrewIndex(payload: unknown): Promise<void> {
  await writeJson(INDEX_PATH, payload);
}

export async function readCrewSnapshot(eventId: string): Promise<unknown | null> {
  return readJson(snapshotPath(eventId));
}

export async function writeCrewSnapshot(
  eventId: string,
  payload: unknown,
): Promise<void> {
  await writeJson(snapshotPath(eventId), payload);
}
