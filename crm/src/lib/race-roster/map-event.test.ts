import { describe, expect, it } from "vitest";

import {
  buildRaceRosterSlug,
  parseRaceRosterUrl,
  resolveRaceRosterNumericId,
} from "./ids";
import { clockFromDate, mapRaceRosterEvent } from "./map-event";
import type { RaceRosterEvent } from "./types";

const sampleEvent: RaceRosterEvent = {
  eventId: "44bf76b5-7c97-11",
  name: "2015 Alcatraz XXXV Escape from the Rock",
  city: "San Francisco",
  region: { code: "CA", name: "California" },
  country: { code: "US", name: "United States" },
  startDate: "2030-06-12T15:19:21+00:00",
  timeZone: "America/Los_Angeles",
  registrationOpenDate: "2029-01-01T00:00:00+00:00",
  registrationCloseDate: "2030-06-11T00:00:00+00:00",
  lastModifiedDate: "2026-01-11T15:19:12+00:00",
  url: "https://raceroster.com/events/2030/761/2015-alcatraz-xxxv-escape-from-the-rock",
  address: "Street 23, San Francisco, CA, 94133",
  latitude: 37.8,
  longitude: -122.4,
  description: "Island race weekend",
  branding: {
    logo: "https://cdn.raceroster.com/event_logo/logo.png",
  },
  resultsUrl: "https://results.raceroster.com/results/am52payyhk52ma9r",
  subEvents: {
    data: [
      {
        subEventId: 12,
        name: "Individual",
        subEventDistance: {
          type: "running",
          label: "5 km",
          value: "5",
          unit: "km",
          inMeters: "5000",
        },
        customSubEventDate: "2030-06-12T15:19:21+00:00",
      },
      {
        subEventId: 15,
        name: "Volunteer Crew",
        distance: "0",
        distanceType: "km",
      },
    ],
  },
};

describe("parseRaceRosterUrl", () => {
  it("extracts year, numeric id, and slug", () => {
    expect(
      parseRaceRosterUrl(
        "https://raceroster.com/events/2030/761/2015-alcatraz-xxxv-escape-from-the-rock",
      ),
    ).toEqual({
      year: 2030,
      numericId: 761,
      slugPart: "2015-alcatraz-xxxv-escape-from-the-rock",
    });
  });
});

describe("resolveRaceRosterNumericId", () => {
  it("prefers the public URL numeric id", () => {
    expect(resolveRaceRosterNumericId(sampleEvent)).toBe(761);
  });

  it("falls back to a stable hash when the URL is missing", () => {
    const id = resolveRaceRosterNumericId({
      eventId: "abc-123",
      name: "Test",
    });
    expect(id).toBeGreaterThan(0);
    expect(
      resolveRaceRosterNumericId({ eventId: "abc-123", name: "Test" }),
    ).toBe(id);
  });
});

describe("clockFromDate", () => {
  it("uses the event timezone instead of UTC hours", () => {
    // Race Roster Black Bear style: 8:00 AM Eastern arrives as -0400 offset.
    expect(
      clockFromDate("2026-10-11T08:00:00-0400", "America/New_York"),
    ).toBe("8:00 AM");
    expect(
      clockFromDate("2026-10-11T08:00:00-0400", "UTC"),
    ).toBe("12:00 PM");
  });

  it("treats local midnight as an absent clock", () => {
    expect(
      clockFromDate("2026-10-11T00:00:00-0400", "America/New_York"),
    ).toBeNull();
  });
});

describe("mapRaceRosterEvent", () => {
  it("maps listing, edition, and offerings for catalog upsert", () => {
    const mapped = mapRaceRosterEvent(sampleEvent, new Date("2026-09-16T12:00:00Z"));
    expect(mapped.listing.sourceProvider).toBe("race_roster");
    expect(mapped.listing.sourceRaceId).toBe(761);
    expect(mapped.listing.slug).toBe(
      "2015-alcatraz-xxxv-escape-from-the-rock-rr-761",
    );
    expect(mapped.listing.logoUrl).toContain("cdn.raceroster.com");
    expect(mapped.listing.city).toBe("San Francisco");
    expect(mapped.listing.state).toBe("CA");
    expect(mapped.listing.descriptionHtml).toContain("Island race weekend");
    expect(mapped.edition.editionYear).toBe(2030);
    expect(mapped.edition.isFuture).toBe(true);
    expect(mapped.offerings).toHaveLength(2);
    expect(mapped.offerings[0]).toMatchObject({
      sourceEventId: 12,
      distanceLabel: "5 km",
      distanceMeters: 5000,
      startTimeRaw: "8:19 AM",
      isRealRaceDistance: true,
      isVolunteer: false,
    });
    expect(mapped.offerings[1]).toMatchObject({
      sourceEventId: 15,
      isVolunteer: true,
      isRealRaceDistance: false,
    });
  });

  it("keeps Race Roster wall-clock times in the event timezone", () => {
    const mapped = mapRaceRosterEvent(
      {
        eventId: "black-bear",
        name: "Black Bear Half Marathon & 8K",
        startDate: "2026-10-11T08:00:00-0400",
        timeZone: "America/New_York",
        url: "https://raceroster.com/events/2026/12345/black-bear-half-marathon-8k",
        subEvents: {
          data: [
            {
              subEventId: 1,
              name: "8K",
              subEventDistance: {
                type: "running",
                label: "8 km",
                inMeters: "8000",
              },
              customSubEventDate: null,
            },
            {
              subEventId: 2,
              name: "Half Marathon",
              subEventDistance: {
                type: "running",
                label: "Half Marathon",
                inMeters: "21097",
              },
            },
          ],
        },
      },
      new Date("2026-09-16T12:00:00Z"),
    );
    expect(mapped.offerings.map((offering) => offering.startTimeRaw)).toEqual([
      "8:00 AM",
      "8:00 AM",
    ]);
  });

  it("builds a provider-scoped slug from the event name when needed", () => {
    expect(
      buildRaceRosterSlug({ eventId: "1", name: "Fall Classic 10K!" }, 99),
    ).toBe("fall-classic-10k-rr-99");
  });
});
