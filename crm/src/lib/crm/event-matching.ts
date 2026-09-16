export function eventMatchKey(name: string) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/^\s*20\d{2}\s+/, "")
    .replace(/\s*[-–—]\s*(renewal|new|timing lead)\s*$/i, "")
    .replace(/&/g, " and ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function calendarDateInZone(
  value: Date | string | null | undefined,
  timeZone = "America/New_York",
) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isGenericEventName(name: string) {
  const key = eventMatchKey(name);
  return key === "private race" || key.startsWith("private races");
}
