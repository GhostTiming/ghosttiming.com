import { describe, expect, it } from "vitest";
import { currentRunSignupEvents } from "./runsignup";
import {
  looksLikeEventUrl,
  parseRaceRosterUrl,
  parseRunSignupDistance,
  parseRunSignupListingId,
  parseRunSignupLocalDateTime,
  parseRunSignupUrl,
  runSignupListingId,
  shouldSearchOnlineListings,
} from "./runsignup-parse";

describe("RunSignUp listing helpers", () => {
  it("parses race URLs, numeric ids, and name slugs", () => {
    expect(
      parseRunSignupUrl(
        "https://runsignup.com/Race/FL/MountDora/MountDoraHalfMarathon5K",
      ),
    ).toEqual({ nameHint: "MountDoraHalfMarathon5K" });
    expect(parseRunSignupUrl("https://runsignup.com/Race/6301")).toEqual({
      raceId: "6301",
    });
    expect(
      parseRunSignupUrl("https://runsignup.com/Race/Events/FL/Orlando/5KMilesToGo"),
    ).toEqual({ nameHint: "5KMilesToGo" });
    expect(parseRunSignupUrl("https://runsignup.com/Race?raceId=174388")).toEqual({
      raceId: "174388",
    });
  });

  it("parses Race Roster event URLs into a searchable name", () => {
    expect(
      parseRaceRosterUrl(
        "https://raceroster.com/events/2026/12345/cycle-mount-dora",
      ),
    ).toEqual({
      eventId: "12345",
      nameHint: "cycle mount dora",
    });
    expect(looksLikeEventUrl("https://raceroster.com/events/2026/1/foo")).toBe(
      true,
    );
    expect(looksLikeEventUrl("Mount Dora Half")).toBe(false);
  });

  it("converts RunSignUp clocks and distances", () => {
    expect(parseRunSignupLocalDateTime("12/19/2026 07:45")).toEqual({
      year: 2026,
      local: "2026-12-19T07:45",
    });
    expect(parseRunSignupDistance("13.1 Miles")).toEqual({
      label: "13.1 Miles",
      miles: 13.1,
      meters: 21082,
    });
    expect(parseRunSignupDistance("5K")?.label).toBe("5K");
    expect(runSignupListingId(6301)).toBe("rsu:6301");
    expect(parseRunSignupListingId("rsu:6301")).toBe("6301");
    expect(parseRunSignupListingId("catalog-id")).toBeNull();
  });

  it("treats URLs and short names as searchable listing queries", () => {
    expect(shouldSearchOnlineListings("https://runsignup.com/Race/6301")).toBe(
      true,
    );
    expect(shouldSearchOnlineListings("6301")).toBe(true);
    expect(shouldSearchOnlineListings("Mount Dora")).toBe(true);
    expect(shouldSearchOnlineListings("ab")).toBe(false);
  });
});

describe("RunSignUp current events", () => {
  it("keeps the next-date year and drops volunteer races", () => {
    const events = currentRunSignupEvents({
      race_id: 6301,
      name: "Mount Dora Half Marathon",
      next_date: "12/19/2026",
      events: [
        {
          name: "Half",
          start_time: "12/19/2026 07:00",
          distance: "13.1 Miles",
        },
        {
          name: "Volunteer",
          start_time: "12/19/2026 06:00",
          volunteer: "T",
        },
        {
          name: "Old half",
          start_time: "12/13/2025 07:00",
          distance: "13.1 Miles",
        },
      ],
    });
    expect(events.map((event) => event.name)).toEqual(["Half"]);
  });
});
