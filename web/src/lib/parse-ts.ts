/** Desktop sends Unix seconds or milliseconds. */
export function parseClientTs(t: number): Date {
  if (!Number.isFinite(t)) return new Date();
  if (t > 10_000_000_000) return new Date(t);
  return new Date(t * 1000);
}
