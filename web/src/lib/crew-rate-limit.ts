/** Per-instance overwrite cap: one snapshot per event per second. */
const lastWrite = new Map<string, number>();

export function checkCrewWriteRate(key: string, minIntervalMs = 800): boolean {
  const now = Date.now();
  const prev = lastWrite.get(key) ?? 0;
  if (now - prev < minIntervalMs) return false;
  lastWrite.set(key, now);
  if (lastWrite.size > 200) {
    for (const [item, ts] of lastWrite) {
      if (now - ts > 60_000) lastWrite.delete(item);
    }
  }
  return true;
}
