import {
  formatMeetingActivityBody,
  meetingEndsAt,
  type MeetingActivityMetadata,
  type OutreachRecordKind,
} from "../crm/outreach-activity";
import type { GoogleCalendarEventWrite } from "./calendar-api";

export function googleMeetHangoutLink(event: {
  hangoutLink?: string | null;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}) {
  if (event.hangoutLink) return event.hangoutLink;
  return (
    event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")
      ?.uri ?? null
  );
}

export function buildOutreachCalendarEvent(input: {
  recordKind: OutreachRecordKind;
  recordId: string;
  subject: string;
  startsAt: Date;
  durationMinutes: number;
  attendees: string[];
  agenda?: string;
  includeGoogleMeet: boolean;
  requestId: string;
}): GoogleCalendarEventWrite {
  const endsAt = meetingEndsAt(input.startsAt, input.durationMinutes);
  const attendees = input.attendees.map((email) => ({ email }));
  const description = formatMeetingActivityBody({
    subject: input.subject,
    startsAt: input.startsAt.toISOString(),
    durationMinutes: input.durationMinutes,
    attendees: input.attendees,
    agenda: input.agenda,
  });
  const privateProperties: Record<string, string> =
    input.recordKind === "prospect"
      ? { crmProspectId: input.recordId }
      : { crmBookingId: input.recordId };

  return {
    summary: input.subject,
    description,
    start: { dateTime: input.startsAt.toISOString() },
    end: { dateTime: endsAt.toISOString() },
    ...(attendees.length ? { attendees, guestsCanInviteOthers: false } : {}),
    extendedProperties: { private: privateProperties },
    ...(input.includeGoogleMeet
      ? {
          conferenceData: {
            createRequest: {
              requestId: input.requestId,
              conferenceSolutionKey: { type: "hangoutsMeet" as const },
            },
          },
        }
      : {}),
  };
}

export function meetingMetadataFromCalendar(input: {
  subject: string;
  startsAt: string;
  durationMinutes: number;
  attendees: string[];
  agenda?: string;
  includeGoogleMeet: boolean;
  calendarId: string;
  eventId: string;
  htmlLink?: string | null;
  hangoutLink?: string | null;
}): MeetingActivityMetadata {
  return {
    subject: input.subject,
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
    attendees: input.attendees,
    includeGoogleMeet: input.includeGoogleMeet,
    googleCalendarId: input.calendarId,
    googleEventId: input.eventId,
    htmlLink: input.htmlLink ?? null,
    hangoutLink: input.hangoutLink ?? null,
  };
}
