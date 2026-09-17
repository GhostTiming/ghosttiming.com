export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  GMAIL_SCOPE,
  GMAIL_SEND_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_LIST_SCOPE,
] as const;

export const GOOGLE_SCOPE_STRING = GOOGLE_SCOPES.join(" ");

export const GMAIL_BODY_MAX_CHARS = 20_000;
export const GMAIL_SEARCH_BATCH_SIZE = 20;
export const GMAIL_INGEST_BATCH_SIZE = 25;
