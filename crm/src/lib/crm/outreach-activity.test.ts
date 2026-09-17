import { describe, expect, it } from "vitest";
import {
  defaultMeetingSubject,
  formatMeetingActivityBody,
  meetingEndsAt,
  parseMeetingAttendees,
  parseMeetingDurationMinutes,
  parseMeetingMetadata,
  validateMeetingWrapUpInput,
} from "./outreach-activity";

describe("outreach meeting helpers", () => {
  it("parses duration, attendees, and end time", () => {
    expect(parseMeetingDurationMinutes("45")).toBe(45);
    expect(() => parseMeetingDurationMinutes("0")).toThrow(/minutes/);
    expect(parseMeetingAttendees("RD@Example.com", ["board@example.org", "rd@example.com"])).toEqual([
      "rd@example.com",
      "board@example.org",
    ]);
    expect(meetingEndsAt(new Date("2026-09-20T18:00:00.000Z"), 30).toISOString()).toBe(
      "2026-09-20T18:30:00.000Z",
    );
  });

  it("builds a Salesforce-style meeting activity body", () => {
    const body = formatMeetingActivityBody({
      subject: defaultMeetingSubject("Mount Dora 5K"),
      startsAt: "2026-09-20T18:00:00.000Z",
      durationMinutes: 30,
      attendees: ["rd@example.org"],
      agenda: "Walk through timing needs.",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      htmlLink: "https://calendar.google.com/event?eid=test",
    });
    expect(body).toContain("Meeting · Mount Dora 5K");
    expect(body).toContain("Attendees: rd@example.org");
    expect(body).toContain("Google Meet: https://meet.google.com/abc-defg-hij");
    expect(body).toContain("Walk through timing needs.");
  });

  it("reads meeting metadata and wrap-up", () => {
    const meeting = parseMeetingMetadata({
      eventType: "meeting",
      meeting: {
        subject: "Meeting · Test",
        startsAt: "2026-09-20T18:00:00.000Z",
        durationMinutes: 15,
        attendees: ["rd@example.org"],
        includeGoogleMeet: true,
        wrapUp: {
          outcome: "unqualified",
          notes: "Race is next week.",
          unqualifiedReason: "event_too_soon",
          wrappedAt: "2026-09-20T19:00:00.000Z",
          wrappedBy: "Michelle",
        },
      },
    });
    expect(meeting?.wrapUp?.outcome).toBe("unqualified");
    expect(
      validateMeetingWrapUpInput({
        recordKind: "prospect",
        notes: "Good fit, sending a quote.",
        outcome: "qualified",
      }).success,
    ).toBe(true);
    expect(
      validateMeetingWrapUpInput({
        recordKind: "prospect",
        notes: "Too soon.",
        outcome: "unqualified",
        unqualifiedReason: "event_too_soon",
      }).success,
    ).toBe(true);
    expect(
      validateMeetingWrapUpInput({
        recordKind: "booking",
        notes: "Confirmed packet pickup.",
      }).success,
    ).toBe(true);
  });
});
