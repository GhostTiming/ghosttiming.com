import { buildRaceRosterSlug, resolveRaceRosterNumericId, resolveRaceRosterSubEventId } from "./ids";
import { RACE_ROSTER_PROVIDER } from "./types";
import type {
  MappedRaceRosterEvent,
  RaceRosterEvent,
  RaceRosterSubEvent,
} from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function descriptionToHtml(description?: string | null) {
  const trimmed = description?.trim();
  if (!trimmed) return null;
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return `<p>${escapeHtml(trimmed).replaceAll("\n", "<br />")}</p>`;
}

function cleanUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function parseAddress(address?: string | null) {
  const trimmed = address?.trim();
  if (!trimmed) {
    return { street: null as string | null, zipcode: null as string | null };
  }
  const zipMatch = trimmed.match(/\b(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d)\b/i);
  const zipcode = zipMatch?.[1] ?? null;
  const withoutZip = zipMatch
    ? trimmed.replace(zipMatch[0], "").replace(/,\s*$/, "").trim()
    : trimmed;
  const parts = withoutZip.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { street: parts.slice(0, -2).join(", "), zipcode };
  }
  return { street: withoutZip || null, zipcode };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value?: string | null) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date;
}

function isoTimestamp(value?: string | null) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function clockFromDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return null;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  if (hours === 0 && minutes === 0) return null;
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function normalizeFamily(type?: string | null) {
  const value = type?.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("run")) return "running";
  if (value.includes("walk")) return "walking";
  if (value.includes("bike") || value.includes("cycl")) return "cycling";
  if (value.includes("swim")) return "swimming";
  if (value.includes("tri")) return "triathlon";
  return value;
}

function isWalkOffering(name: string, distanceType?: string | null, eventType?: string | null) {
  const haystack = `${name} ${distanceType ?? ""} ${eventType ?? ""}`.toLowerCase();
  return /\bwalk\b/.test(haystack) && !/\brun\b/.test(haystack);
}

function isVirtualOffering(name: string) {
  return /\bvirtual\b/i.test(name);
}

function isVolunteerOffering(name: string) {
  return /\bvolunteer\b/i.test(name);
}

function isMerchOnlyOffering(name: string, meters: number | null) {
  if (meters && meters > 0) return false;
  return /\b(merch|shirt only|t-?shirt only|medal only)\b/i.test(name);
}

function subEventsOf(event: RaceRosterEvent): RaceRosterSubEvent[] {
  const raw = event.subEvents;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  return [];
}

function registrationOpen(
  openDate?: string | null,
  closeDate?: string | null,
  now = new Date(),
) {
  const open = parseDate(openDate);
  const close = parseDate(closeDate);
  if (open && now < open) return false;
  if (close && now > close) return false;
  if (!open && !close) return null;
  return true;
}

export function mapRaceRosterEvent(
  event: RaceRosterEvent,
  fetchedAt = new Date(),
): MappedRaceRosterEvent {
  const sourceRaceId = resolveRaceRosterNumericId(event);
  const start = parseDate(event.startDate);
  const startIso = start?.toISOString() ?? null;
  const now = fetchedAt;
  const isFuture = Boolean(start && start.getTime() >= now.getTime() - 12 * 60 * 60 * 1000);
  const address = parseAddress(event.address);
  const offeringsSource = subEventsOf(event);
  const editionYear = start?.getUTCFullYear() ?? null;
  const sourceRaceEventDaysId = editionYear && editionYear > 0 ? editionYear : 0;

  const offerings = offeringsSource.map((subEvent) => {
    const sourceEventId = resolveRaceRosterSubEventId(subEvent.subEventId, sourceRaceId);
    const meters =
      toNumber(subEvent.subEventDistance?.inMeters) ??
      (() => {
        const value = toNumber(subEvent.distance);
        const unit = (subEvent.distanceType || subEvent.subEventDistance?.unit || "")
          .toLowerCase()
          .trim();
        if (value == null) return null;
        if (unit === "m" || unit === "meter" || unit === "meters") return value;
        if (unit === "km" || unit === "kilometer" || unit === "kilometers") {
          return value * 1000;
        }
        if (unit === "mi" || unit === "mile" || unit === "miles") {
          return value * 1609.344;
        }
        return null;
      })();
    const distanceLabel =
      subEvent.subEventDistance?.label?.trim() ||
      (subEvent.distance != null && subEvent.distanceType
        ? `${subEvent.distance} ${subEvent.distanceType}`
        : null);
    const name = subEvent.name?.trim() || distanceLabel || `Sub-event ${sourceEventId}`;
    const eventType = subEvent.subEventDistance?.type?.trim() || null;
    const offeringStart =
      isoTimestamp(subEvent.customSubEventDate) ?? startIso;
    const isVirtual = isVirtualOffering(name);
    const isWalk = isWalkOffering(name, subEvent.distanceType, eventType);
    const isVolunteer = isVolunteerOffering(name);
    const isMerchOnly = isMerchOnlyOffering(name, meters);

    return {
      sourceProvider: RACE_ROSTER_PROVIDER,
      sourceRaceId,
      sourceEventId,
      sourceRaceEventDaysId,
      name,
      distanceLabel,
      distanceMeters: meters,
      startTimeRaw: clockFromDate(subEvent.customSubEventDate ?? event.startDate),
      startsAt: offeringStart,
      eventType,
      normalizedEventFamily: normalizeFamily(eventType),
      isRealRaceDistance: Boolean(meters && meters > 0 && !isMerchOnly && !isVolunteer),
      isVirtual,
      isWalk,
      isMerchOnly,
      isVolunteer,
      registrationPeriodsJson: {
        open: event.registrationOpenDate ?? null,
        close: event.registrationCloseDate ?? null,
      },
      rawJson: subEvent,
    };
  });

  const futureOfferingCount = offerings.filter((offering) => {
    const at = offering.startsAt ? new Date(offering.startsAt) : start;
    return at ? at.getTime() >= now.getTime() - 12 * 60 * 60 * 1000 : isFuture;
  }).length;

  return {
    listing: {
      sourceProvider: RACE_ROSTER_PROVIDER,
      sourceRaceId,
      raceRosterEventId: String(event.eventId),
      name: event.name.trim(),
      slug: buildRaceRosterSlug(event, sourceRaceId),
      descriptionHtml: descriptionToHtml(event.description),
      logoUrl: cleanUrl(event.branding?.logo),
      registrationUrl: cleanUrl(event.url),
      externalRaceUrl: cleanUrl(event.url),
      externalResultsUrl: cleanUrl(event.resultsUrl),
      street: address.street,
      street2: null,
      city: event.city?.trim() || null,
      state: event.region?.code?.trim() || event.region?.name?.trim() || null,
      zipcode: address.zipcode,
      countryCode: event.country?.code?.trim() || null,
      timezone: event.timeZone?.trim() || null,
      latitude: toNumber(event.latitude),
      longitude: toNumber(event.longitude),
      nextStartAt: isFuture ? startIso : null,
      firstStartAt: startIso,
      lastStartAt: startIso,
      isRegistrationOpen: registrationOpen(
        event.registrationOpenDate,
        event.registrationCloseDate,
        now,
      ),
      sourceLastFetchedAt: now.toISOString(),
      sourceLastModified: event.lastModifiedDate?.trim() || null,
    },
    edition: {
      sourceProvider: RACE_ROSTER_PROVIDER,
      sourceRaceId,
      sourceRaceEventDaysId,
      editionYear,
      startsAt: startIso,
      timezone: event.timeZone?.trim() || null,
      isFuture,
      isHistorical: !isFuture,
      offeringCount: offerings.length,
      futureOfferingCount,
      historicalOfferingCount: Math.max(offerings.length - futureOfferingCount, 0),
    },
    offerings,
  };
}
