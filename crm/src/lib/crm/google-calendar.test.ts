import { describe, expect, it } from "vitest";
import {
  buildGoogleCalendarEventResource,
  buildGoogleCalendarUrl,
  formatCalendarMultilineField,
  formatCalendarRaceClock,
  formatCalendarRaceHeading,
  googleCalendarEventDescription,
} from "./google-calendar";

const baseBooking = {
  year: 2027,
  eventName: "Fiddlin 5K",
  startAt: "2027-04-03T10:00:00.000Z",
  endAt: "2027-04-03T16:00:00.000Z",
  location: "123 Main St, Concord, NH",
  registrationUrl: "https://example.com/register",
  crew: [
    {
      name: "Seth Doe",
      email: "seth@example.com",
      phone: "555-0100",
      role: "Lead",
    },
    { name: "Chris Batista" },
  ],
  races: [
    {
      name: "5K",
      distanceLabel: "5K",
      startTime: "2027-04-03 08:00:00",
      ageGroups: "Overall\n0-9\n10-14",
      awards: "Overall M/F",
    },
  ],
};

describe("Google Calendar booking links", () => {
  it("prefills title, UTC dates, location, crew, and race details", () => {
    const url = buildGoogleCalendarUrl(baseBooking);
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("2027 Fiddlin 5K");
    expect(parsed.searchParams.get("dates")).toBe(
      "20270403T100000Z/20270403T160000Z",
    );
    expect(parsed.searchParams.get("location")).toBe(
      "123 Main St, Concord, NH",
    );
    expect(parsed.searchParams.get("details")).toContain(
      "Crew:\nMichelle Splitstone-Laloggia · (407) 687-2570\nSeth Doe (Lead) · 555-0100\nChris Batista",
    );
    expect(parsed.searchParams.get("details")).not.toContain("seth@example.com");
    expect(parsed.searchParams.get("details")).toContain("5K @ 8:00AM Start");
    expect(parsed.searchParams.get("details")).toContain(
      "5K @ 8:00AM Start\n\nAge Groups:",
    );
    expect(parsed.searchParams.get("details")).toContain("Age Groups:\nOverall");
    expect(parsed.searchParams.get("details")).toContain(
      "Age Groups:\nOverall\n0-9\n10-14\n\nAwards:",
    );
    expect(parsed.searchParams.get("add")).toBe("seth@example.com");
  });

  it("uses Remote as the supplied location", () => {
    const url = buildGoogleCalendarUrl({
      year: 2027,
      eventName: "Remote Race",
      startAt: "2027-01-01T12:00:00Z",
      endAt: "2027-01-01T13:00:00Z",
      location: "Remote",
      crew: [],
      races: [],
    });
    expect(new URL(url!).searchParams.get("location")).toBe("Remote");
  });

  it("does not create a link for invalid or reversed times", () => {
    expect(
      buildGoogleCalendarUrl({
        year: 2027,
        eventName: "Race",
        startAt: "2027-01-01T13:00:00Z",
        endAt: "2027-01-01T12:00:00Z",
        location: "",
        crew: [],
        races: [],
      }),
    ).toBeNull();
  });

  it("stores the CRM booking id in private calendar metadata and invites crew", () => {
    const event = buildGoogleCalendarEventResource({
      bookingId: "11111111-1111-1111-1111-111111111111",
      ...baseBooking,
    });
    expect(event?.extendedProperties.private.crmBookingId).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(event?.summary).toBe("2027 Fiddlin 5K");
    expect(event?.attendees).toEqual([
      { email: "seth@example.com", displayName: "Seth Doe (Lead)" },
    ]);
    expect(event?.description).toContain("Seth Doe (Lead) · 555-0100");
    expect(event?.description).not.toContain("seth@example.com");
  });

  it("puts crew phone numbers in the description without repeating emails", () => {
    expect(googleCalendarEventDescription(baseBooking)).toContain(
      "Crew:\nMichelle Splitstone-Laloggia · (407) 687-2570\nSeth Doe (Lead) · 555-0100\nChris Batista",
    );
    expect(googleCalendarEventDescription(baseBooking)).not.toContain(
      "seth@example.com",
    );
  });
});

describe("calendar race copy", () => {
  it("prints start time without the date", () => {
    expect(formatCalendarRaceClock("2026-09-19 08:00:00")).toBe("8:00AM");
    expect(formatCalendarRaceClock("2026-09-19T08:30:00")).toBe("8:30AM");
    expect(formatCalendarRaceClock("17:40:00")).toBe("5:40PM");
  });

  it("puts the race name, distance, and start on one line", () => {
    expect(
      formatCalendarRaceHeading({
        name: "Miles To Go 5K Run/Walk",
        distanceLabel: "3.1 Miles",
        startTime: "2026-09-19 08:00:00",
      }),
    ).toBe("Miles To Go 5K Run/Walk (3.1 Miles) @ 8:00AM Start");
  });

  it("keeps pasted age groups and awards as a list under the label", () => {
    expect(formatCalendarMultilineField("Age Groups", "Overall\n0-9")).toBe(
      "Age Groups:\nOverall\n0-9",
    );
    expect(formatCalendarMultilineField("Awards", "Overall M/F")).toBe(
      "Awards:\nOverall M/F",
    );
  });

  it("omits blank age groups, awards, and notes", () => {
    expect(
      googleCalendarEventDescription({
        ...baseBooking,
        races: [
          {
            name: "5K",
            distanceLabel: "5K",
            startTime: "2027-04-03 08:00:00",
          },
        ],
      }),
    ).toBe(
      [
        "Race Registration:\nhttps://example.com/register",
        "Crew:\nMichelle Splitstone-Laloggia · (407) 687-2570\nSeth Doe (Lead) · 555-0100\nChris Batista",
        "Race(s):\n5K @ 8:00AM Start",
      ].join("\n\n"),
    );
  });

  it("prints notes only when they have content", () => {
    expect(
      googleCalendarEventDescription({
        ...baseBooking,
        races: [
          {
            name: "5K",
            startTime: "08:00:00",
            notes: "Chip start; no day-of registration",
          },
        ],
      }),
    ).toContain("Notes:\nChip start; no day-of registration");
  });

  it("puts a blank line between calendar description fields", () => {
    expect(googleCalendarEventDescription(baseBooking)).toBe(
      [
        "Race Registration:\nhttps://example.com/register",
        "Crew:\nMichelle Splitstone-Laloggia · (407) 687-2570\nSeth Doe (Lead) · 555-0100\nChris Batista",
        "Race(s):\n5K @ 8:00AM Start",
        "Age Groups:\nOverall\n0-9\n10-14",
        "Awards:\nOverall M/F",
      ].join("\n\n"),
    );
  });

  it("adds Michelle to crew by default and does not duplicate her", () => {
    expect(googleCalendarEventDescription({ ...baseBooking, crew: [] })).toContain(
      "Crew:\nMichelle Splitstone-Laloggia · (407) 687-2570",
    );
    expect(
      googleCalendarEventDescription({
        ...baseBooking,
        crew: [
          {
            name: "Michelle Splitstone-Laloggia",
            phone: "(407) 687-2570",
            role: "Owner",
          },
        ],
      }),
    ).toBe(
      [
        "Race Registration:\nhttps://example.com/register",
        "Crew:\nMichelle Splitstone-Laloggia (Owner) · (407) 687-2570",
        "Race(s):\n5K @ 8:00AM Start",
        "Age Groups:\nOverall\n0-9\n10-14",
        "Awards:\nOverall M/F",
      ].join("\n\n"),
    );
  });

  it("adds hardware event and point names at the bottom of the invite", () => {
    expect(
      googleCalendarEventDescription({
        ...baseBooking,
        hardwareEventName: "MTG5K",
        coursePoints: [{ name: "Start/Finish", hardwarePointName: "MAIN" }],
      }),
    ).toBe(
      [
        "Race Registration:\nhttps://example.com/register",
        "Crew:\nMichelle Splitstone-Laloggia · (407) 687-2570\nSeth Doe (Lead) · 555-0100\nChris Batista",
        "Race(s):\n5K @ 8:00AM Start",
        "Age Groups:\nOverall\n0-9\n10-14",
        "Awards:\nOverall M/F",
        "Event Name to Program:\nMTG5K",
        "Start / Split / Finish Locations and Point Name to Program:\nStart/Finish • Point name: MAIN",
      ].join("\n\n"),
    );
  });
});
