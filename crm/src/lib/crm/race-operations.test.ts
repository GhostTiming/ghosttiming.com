import { describe, expect, it } from "vitest";
import {
  catalogOfferingStartTimestamp,
  earliestNonVirtualCatalogStart,
  estimateRaceDurationMinutes,
  excludeVirtualCatalogOfferings,
  isVirtualCatalogOffering,
  offeringsMatchingOccurrenceDate,
  parseCatalogClock,
  preferredCatalogEditionId,
  preferredCatalogEditionSql,
} from "./race-operations";

describe("race duration defaults", () => {
  it.each([
    ["1 Mile", 60],
    ["5K", 120],
    ["10k", 180],
    ["15 K", 240],
    ["Half-Marathon", 300],
    ["Marathon", 480],
  ])("uses the configured duration for %s", (label, minutes) => {
    expect(estimateRaceDurationMinutes(label)).toBe(minutes);
  });

  it("estimates custom mileage and rounds up to 15 minutes", () => {
    expect(estimateRaceDurationMinutes("9K", 5.6)).toBe(150);
  });

  it("can estimate from meters", () => {
    expect(estimateRaceDurationMinutes("Custom", null, 8_000)).toBe(135);
  });

  it("requires a manual duration when no distance is known", () => {
    expect(estimateRaceDurationMinutes("Fun run")).toBeNull();
  });
});

describe("catalog offering start times", () => {
  it("reads the posted local clock instead of the UTC-shifted timestamp", () => {
    expect(parseCatalogClock("10/18/2026 07:40")).toEqual({ hours: 7, minutes: 40 });
    expect(
      catalogOfferingStartTimestamp({
        raceDate: "2026-10-18T04:00:00.000Z",
        startTimeRaw: "10/18/2026 07:40",
        startsAt: "2026-10-18 11:40:00",
      }),
    ).toBe("2026-10-18 07:40:00");
  });

  it("keeps the booking date when the catalog offering is from another year", () => {
    expect(
      catalogOfferingStartTimestamp({
        raceDate: "2026-09-19",
        startTimeRaw: "9/13/2025 08:30",
        startsAt: "2025-09-13 08:30:00",
      }),
    ).toBe("2026-09-19 08:30:00");
  });
});

describe("virtual catalog offerings", () => {
  it("excludes a virtual 5K by name, type, tag, or flag", () => {
    expect(isVirtualCatalogOffering({ name: "Virtual 5K" })).toBe(true);
    expect(
      isVirtualCatalogOffering({
        name: "5K",
        event_type: "virtual_race",
      }),
    ).toBe(true);
    expect(isVirtualCatalogOffering({ name: "5K", tag: "Virtual" })).toBe(true);
    expect(
      isVirtualCatalogOffering({
        name: "5K",
        is_virtual: true,
      }),
    ).toBe(true);
  });

  it("includes an in-person marathon", () => {
    expect(
      isVirtualCatalogOffering({
        name: "Marathon",
        distance_label: "26.2 Miles",
        event_type: "running_race",
        normalized_event_family: "RUN",
        is_virtual: false,
      }),
    ).toBe(false);
  });

  it("copies only non-virtual races from a mixed listing", () => {
    expect(
      excludeVirtualCatalogOfferings([
        {
          name: "Virtual 5K",
          is_virtual: true,
          event_type: "virtual_race",
        },
        {
          name: "Marathon",
          is_virtual: false,
          event_type: "running_race",
        },
        {
          name: "10K",
          type: "Virtual",
          is_virtual: false,
        },
      ]).map((offering) => offering.name),
    ).toEqual(["Marathon"]);
  });

  it("keeps split-weekend offerings on their own calendar day", () => {
    const offerings = [
      {
        name: "5K",
        start_time_raw: "3/14/2026 07:30",
        starts_at: "2026-03-14 07:30:00",
      },
      {
        name: "Half Marathon",
        start_time_raw: "3/15/2026 07:00",
        starts_at: "2026-03-15 07:00:00",
      },
    ];
    expect(
      offeringsMatchingOccurrenceDate(offerings, "2026-03-14").map((row) => row.name),
    ).toEqual(["5K"]);
    expect(
      offeringsMatchingOccurrenceDate(offerings, "2026-03-15").map((row) => row.name),
    ).toEqual(["Half Marathon"]);
    expect(offeringsMatchingOccurrenceDate(offerings, "2026-03-16")).toEqual([]);
  });

  it("uses the earliest non-virtual start for booking date and time", () => {
    expect(
      earliestNonVirtualCatalogStart([
        {
          name: "Virtual 5K",
          is_virtual: true,
          start_time_raw: "10/17/2026 06:00",
          starts_at: "2026-10-17 06:00:00",
        },
        {
          name: "5K",
          start_time_raw: "10/18/2026 07:40",
          starts_at: "2026-10-18 07:40:00",
        },
        {
          name: "Marathon",
          start_time_raw: "10/18/2026 07:00",
          starts_at: "2026-10-18 07:00:00",
        },
      ]),
    ).toBe("2026-10-18 07:00:00");
  });

  it("falls back to null when every offering is virtual", () => {
    expect(
      earliestNonVirtualCatalogStart([
        {
          name: "Virtual 5K",
          is_virtual: true,
          start_time_raw: "10/18/2026 06:00",
          starts_at: "2026-10-18 06:00:00",
        },
        {
          name: "Virtual 10K",
          event_type: "virtual_race",
          start_time_raw: "10/18/2026 07:00",
          starts_at: "2026-10-18 07:00:00",
        },
      ]),
    ).toBeNull();
  });
});

describe("preferred catalog edition", () => {
  it("does not shadow an outer listing alias in the next-start subquery", () => {
    const sql = preferredCatalogEditionSql("listing.id");
    expect(sql).toContain("WHERE id = listing.id");
    expect(sql).not.toContain("WHERE listing.id = listing.id");
  });

  it("picks the live Get Run Vibes edition instead of a past year", () => {
    expect(
      preferredCatalogEditionId(
        [
          {
            id: "2023",
            is_future: false,
            starts_at: "2023-10-21 07:00:00",
            edition_year: 2023,
          },
          {
            id: "2025",
            is_future: false,
            starts_at: "2025-11-02 06:00:00",
            edition_year: 2025,
          },
          {
            id: "2026",
            is_future: true,
            starts_at: "2026-11-15 12:00:00",
            edition_year: 2026,
          },
        ],
        "2026-11-15 11:45:00+00",
      ),
    ).toBe("2026");
  });
});
