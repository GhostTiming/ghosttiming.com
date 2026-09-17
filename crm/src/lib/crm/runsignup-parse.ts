export const RUNSIGNUP_LISTING_PREFIX = "rsu:";

export type ParsedRunSignupUrl = {
  raceId?: string;
  nameHint?: string;
};

export type ParsedRaceRosterUrl = {
  eventId?: string;
  nameHint?: string;
};

export function runSignupListingId(raceId: string | number) {
  return `${RUNSIGNUP_LISTING_PREFIX}${String(raceId)}`;
}

export function parseRunSignupListingId(value: string) {
  if (!value.startsWith(RUNSIGNUP_LISTING_PREFIX)) return null;
  const raceId = value.slice(RUNSIGNUP_LISTING_PREFIX.length).trim();
  return /^\d+$/.test(raceId) ? raceId : null;
}

export function parseRunSignupLocalDateTime(value: string | null | undefined) {
  if (!value) return null;
  const match = value
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  const year = match[3];
  const hour = (match[4] ?? "00").padStart(2, "0");
  const minute = match[5] ?? "00";
  return {
    year: Number(year),
    local: `${year}-${month}-${day}T${hour}:${minute}`,
  };
}

export function parseRunSignupDistance(value: string | null | undefined) {
  if (!value?.trim()) {
    return { label: null as string | null, miles: null as number | null, meters: null as number | null };
  }
  const text = value.trim();
  const miles = text.match(/^(\d+(?:\.\d+)?)\s*(miles?|mi)\b/i);
  if (miles) {
    const amount = Number(miles[1]);
    return { label: text, miles: amount, meters: Math.round(amount * 1609.344) };
  }
  const kilometers = text.match(/^(\d+(?:\.\d+)?)\s*(k|km|kilometers?)\b/i);
  if (kilometers) {
    const amount = Number(kilometers[1]);
    return {
      label: text,
      miles: Number((amount * 0.621371).toFixed(3)),
      meters: Math.round(amount * 1000),
    };
  }
  return { label: text, miles: null, meters: null };
}

export function parseRunSignupUrl(input: string): ParsedRunSignupUrl | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/(^|\.)runsignup\.com$/i.test(url.hostname)) return null;
  const fromQuery =
    url.searchParams.get("raceId") ||
    url.searchParams.get("race_id") ||
    url.searchParams.get("raceID");
  if (fromQuery && /^\d+$/.test(fromQuery)) return { raceId: fromQuery };
  const numericPath = url.pathname.match(/\/(?:Race|race|Rest\/race)\/(\d+)\b/i);
  if (numericPath) return { raceId: numericPath[1] };
  const named = url.pathname.match(
    /\/Race\/(?:Events\/)?[A-Za-z]{2}\/[^/]+\/([^/?#]+)/i,
  );
  if (named?.[1]) {
    return { nameHint: decodeURIComponent(named[1]).replace(/[-_]+/g, " ") };
  }
  return { nameHint: decodeURIComponent(url.pathname).replace(/[-_/]+/g, " ").trim() };
}

export function parseRaceRosterUrl(input: string): ParsedRaceRosterUrl | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/(^|\.)raceroster\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/events\/(\d{4})\/(\d+)(?:\/([^/?#]+))?/i);
  if (!match) {
    return { nameHint: decodeURIComponent(url.pathname).replace(/[-_/]+/g, " ").trim() };
  }
  return {
    eventId: match[2],
    nameHint: match[3]
      ? decodeURIComponent(match[3]).replace(/[-_]+/g, " ")
      : undefined,
  };
}

export function looksLikeEventUrl(input: string) {
  return Boolean(parseRunSignupUrl(input) || parseRaceRosterUrl(input));
}

export function shouldSearchOnlineListings(query: string) {
  const search = query.trim();
  if (!search) return false;
  if (looksLikeEventUrl(search)) return true;
  if (/^\d{3,}$/.test(search)) return true;
  return search.replace(/[^a-z0-9]+/gi, " ").trim().length >= 3;
}
