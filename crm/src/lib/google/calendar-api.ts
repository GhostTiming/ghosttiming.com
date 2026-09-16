import { googleFetch } from "./google-fetch";
import type { GoogleCalendarEventResource } from "@/lib/crm/google-calendar";

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
};

export type GoogleCalendarEvent = GoogleCalendarEventResource & {
  id?: string;
  htmlLink?: string;
  status?: string;
};

export async function listGoogleCalendars(accessToken: string) {
  const result = await googleFetch<{ items?: GoogleCalendarListEntry[] }>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer",
  );
  return result.items ?? [];
}

function eventUrl(calendarId: string, eventId?: string) {
  const calendar = encodeURIComponent(calendarId);
  const base = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(eventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`;
  return `${base}?sendUpdates=all`;
}

export function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleCalendarEventResource,
) {
  return googleFetch<GoogleCalendarEvent>(accessToken, eventUrl(calendarId), {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleCalendarEventResource,
) {
  return googleFetch<GoogleCalendarEvent>(accessToken, eventUrl(calendarId, eventId), {
    method: "PUT",
    body: JSON.stringify(event),
  });
}

export function getGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  return googleFetch<GoogleCalendarEvent>(accessToken, eventUrl(calendarId, eventId));
}
