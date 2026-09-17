import { googleFetch } from "./google-fetch";
import type { GoogleCalendarEventResource } from "@/lib/crm/google-calendar";

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
};

export type GoogleCalendarEventWrite = {
  summary: string;
  location?: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  guestsCanInviteOthers?: boolean;
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: "hangoutsMeet" };
    };
  };
  extendedProperties?: {
    private: Record<string, string>;
  };
};

export type GoogleCalendarEvent = Omit<GoogleCalendarEventWrite, "conferenceData"> &
  Partial<GoogleCalendarEventResource> & {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    status?: string;
    conferenceData?: {
      createRequest?: {
        requestId: string;
        conferenceSolutionKey: { type: "hangoutsMeet" };
      };
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    };
  };

export async function listGoogleCalendars(accessToken: string) {
  const result = await googleFetch<{ items?: GoogleCalendarListEntry[] }>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer",
  );
  return result.items ?? [];
}

function eventUrl(
  calendarId: string,
  eventId?: string,
  options: { sendUpdates?: "all" | "none"; conferenceDataVersion?: number } = {},
) {
  const calendar = encodeURIComponent(calendarId);
  const base = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(eventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`;
  const params = new URLSearchParams({
    sendUpdates: options.sendUpdates ?? "none",
  });
  if (options.conferenceDataVersion != null) {
    params.set("conferenceDataVersion", String(options.conferenceDataVersion));
  }
  return `${base}?${params}`;
}

export function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleCalendarEventWrite,
) {
  return googleFetch<GoogleCalendarEvent>(
    accessToken,
    eventUrl(calendarId, undefined, {
      sendUpdates: "all",
      conferenceDataVersion: event.conferenceData ? 1 : undefined,
    }),
    {
      method: "POST",
      body: JSON.stringify(event),
    },
  );
}

export function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleCalendarEventWrite,
) {
  return googleFetch<GoogleCalendarEvent>(
    accessToken,
    eventUrl(calendarId, eventId, {
      sendUpdates: "none",
      conferenceDataVersion: event.conferenceData ? 1 : undefined,
    }),
    {
      method: "PUT",
      body: JSON.stringify(event),
    },
  );
}

export function getGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  return googleFetch<GoogleCalendarEvent>(accessToken, eventUrl(calendarId, eventId));
}
