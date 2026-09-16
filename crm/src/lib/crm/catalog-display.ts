export const perkTagLabels: Record<string, string> = {
  swag_included: "Swag included",
  shirt: "Shirt",
  medal: "Medal",
  food_drink: "Food & drink",
  awards: "Awards",
  after_party: "After party",
  dog_friendly: "Dog friendly",
  swag_generic: "Swag",
};

export const vibeTagLabels: Record<string, string> = {
  fun: "Fun",
  scenic: "Scenic",
  competitive: "Competitive",
  quirky: "Quirky",
  festive: "Festive",
  cause_driven: "Cause-driven",
};

const perkOrder = [
  "swag_included",
  "shirt",
  "medal",
  "food_drink",
  "awards",
  "after_party",
  "dog_friendly",
  "swag_generic",
];

const vibeOrder = [
  "scenic",
  "fun",
  "festive",
  "quirky",
  "competitive",
  "cause_driven",
];

export function labelPerkTag(key: string) {
  return perkTagLabels[key] ?? key.replaceAll("_", " ");
}

export function labelVibeTag(key: string) {
  return vibeTagLabels[key] ?? key.replaceAll("_", " ");
}

export function sortPerkKeys(keys: readonly string[]) {
  const unique = [...new Set(keys)];
  const filtered = unique.includes("swag_included")
    ? unique.filter((key) => key !== "swag_generic")
    : unique;
  return filtered.sort(
    (a, b) =>
      (perkOrder.indexOf(a) + 1 || 99) - (perkOrder.indexOf(b) + 1 || 99),
  );
}

export function sortVibeKeys(keys: readonly string[]) {
  return [...new Set(keys)].sort(
    (a, b) =>
      (vibeOrder.indexOf(a) + 1 || 99) - (vibeOrder.indexOf(b) + 1 || 99),
  );
}

export function htmlToPlainText(html: string) {
  return html
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function getRunVibesEventUrl(slug: string | null | undefined) {
  if (!slug?.trim()) return null;
  return `https://getrunvibes.com/events/${slug.trim()}`;
}

function isMidnightClock(label: string) {
  return /12:00\s*AM/i.test(label) || /^00:00/.test(label);
}

export function formatOfferingClock(
  startTimeRaw: string | null | undefined,
  startsAt: string | null | undefined,
  timeZone: string | null | undefined,
) {
  const match = startTimeRaw?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    const hours = Number(match[1]);
    const minutes = match[2];
    if (match[3]) {
      const period = match[3].toUpperCase();
      if (!(hours === 12 && minutes === "00" && period === "AM")) {
        return `${hours}:${minutes} ${period}`;
      }
    } else if (!(hours === 0 && minutes === "00")) {
      const period = hours >= 12 ? "PM" : "AM";
      return `${hours % 12 || 12}:${minutes} ${period}`;
    }
  }

  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.valueOf())) return null;
  const label = new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
    timeZone: timeZone || "America/New_York",
  }).format(date);
  return isMidnightClock(label) ? null : label;
}
