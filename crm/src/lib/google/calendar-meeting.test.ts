import { describe, expect, it } from "vitest";
import { buildOutreachCalendarEvent, googleMeetHangoutLink } from "./calendar-meeting";

describe("outreach calendar events", () => {
  it("creates a Meet conference request and attendee list", () => {
    const event = buildOutreachCalendarEvent({
      recordKind: "prospect",
      recordId: "11111111-1111-1111-1111-111111111111",
      subject: "Meeting · Mount Dora 5K",
      startsAt: new Date("2026-09-20T18:00:00.000Z"),
      durationMinutes: 45,
      attendees: ["rd@example.org", "board@example.org"],
      agenda: "Timing quote",
      includeGoogleMeet: true,
      requestId: "meet-request-1",
    });
    expect(event.summary).toBe("Meeting · Mount Dora 5K");
    expect(event.start.dateTime).toBe("2026-09-20T18:00:00.000Z");
    expect(event.end.dateTime).toBe("2026-09-20T18:45:00.000Z");
    expect(event.attendees).toEqual([
      { email: "rd@example.org" },
      { email: "board@example.org" },
    ]);
    expect(event.conferenceData?.createRequest.requestId).toBe("meet-request-1");
    expect(event.extendedProperties?.private).toEqual({
      crmProspectId: "11111111-1111-1111-1111-111111111111",
    });
    expect(event.description).toContain("Timing quote");
  });

  it("omits Meet data when unchecked", () => {
    const event = buildOutreachCalendarEvent({
      recordKind: "booking",
      recordId: "22222222-2222-2222-2222-222222222222",
      subject: "Meeting · Winter 5K",
      startsAt: new Date("2026-09-20T18:00:00.000Z"),
      durationMinutes: 15,
      attendees: [],
      includeGoogleMeet: false,
      requestId: "unused",
    });
    expect(event.conferenceData).toBeUndefined();
    expect(event.attendees).toBeUndefined();
    expect(event.extendedProperties?.private).toEqual({
      crmBookingId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("prefers hangoutLink then video entry point", () => {
    expect(googleMeetHangoutLink({ hangoutLink: "https://meet.google.com/abc" })).toBe(
      "https://meet.google.com/abc",
    );
    expect(
      googleMeetHangoutLink({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1" },
            { entryPointType: "video", uri: "https://meet.google.com/xyz" },
          ],
        },
      }),
    ).toBe("https://meet.google.com/xyz");
  });
});
