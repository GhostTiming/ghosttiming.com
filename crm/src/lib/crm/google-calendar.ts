import { normalizeEmail } from "../contact-extraction/extract";

export type CalendarRace = {
  name: string;
  distanceLabel?: string | null;
  startTime?: string | null;
  ageGroups?: string | null;
  awards?: string | null;
};

export type CalendarCrewMember = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
};

export type GoogleCalendarBooking = {
  year: number | null;
  eventName: string;
  startAt: string;
  endAt: string;
  location: string;
  registrationUrl?: string | null;
  crew: CalendarCrewMember[];
  races: CalendarRace[];
};

function googleDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(".000", "");
}

export function formatCalendarRaceClock(startTime?: string | null) {
  const match = startTime?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return "TBD";
  let hours = Number(match[1]);
  const minutes = match[2];
  if (!Number.isFinite(hours)) return "TBD";
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return minutes === "00" ? `${hours} ${period}` : `${hours}:${minutes} ${period}`;
}

export function formatCalendarMultilineField(
  label: string,
  value?: string | null,
) {
  const lines = (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length);
  if (!lines.length) return `${label}: Not set`;
  if (lines.length === 1) return `${label}: ${lines[0]}`;
  return [`${label}:`, ...lines.map((line) => `  ${line}`)].join("\n");
}

export function calendarCrewLabel(member: CalendarCrewMember) {
  const name = member.name.trim();
  const role = member.role?.trim();
  return role ? `${name} (${role})` : name;
}

export function calendarCrewDescriptionLine(member: CalendarCrewMember) {
  const label = calendarCrewLabel(member);
  const phone = member.phone?.trim();
  return phone ? `${label} · ${phone}` : label;
}

export function calendarCrewAttendees(crew: CalendarCrewMember[]) {
  const seen = new Set<string>();
  const attendees: Array<{ email: string; displayName: string }> = [];
  for (const member of crew) {
    if (!member.email?.trim()) continue;
    const email = normalizeEmail(member.email);
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    attendees.push({ email, displayName: calendarCrewLabel(member) });
  }
  return attendees;
}

function raceDescription(race: CalendarRace) {
  const heading =
    race.distanceLabel && race.distanceLabel !== race.name
      ? `${race.name} (${race.distanceLabel})`
      : race.name;
  return [
    heading,
    `Start: ${formatCalendarRaceClock(race.startTime)}`,
    formatCalendarMultilineField("Age Groups", race.ageGroups),
    formatCalendarMultilineField("Awards", race.awards),
  ].join("\n\n");
}

export const CRM_BOOKING_PRIVATE_PROPERTY = "crmBookingId";

export function googleCalendarEventTitle(input: GoogleCalendarBooking) {
  return `${input.year ?? ""} ${input.eventName}`.trim();
}

export function googleCalendarEventDescription(input: GoogleCalendarBooking) {
  const crewLabels = input.crew
    .map((member) => calendarCrewDescriptionLine(member))
    .filter(Boolean);
  return [
    `Race Registration: ${input.registrationUrl || "Not set"}`,
    `Crew: ${crewLabels.length ? crewLabels.join(", ") : "None assigned"}`,
    [
      "Races:",
      input.races.length
        ? input.races.map(raceDescription).join("\n\n")
        : "No races entered",
    ].join("\n\n"),
  ].join("\n\n");
}

export function googleCalendarTimesAreValid(
  input: Pick<GoogleCalendarBooking, "startAt" | "endAt">,
) {
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  return !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf()) && end > start;
}

export type GoogleCalendarEventResource = {
  summary: string;
  location: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: Array<{ email: string; displayName: string }>;
  guestsCanInviteOthers?: boolean;
  extendedProperties: {
    private: { crmBookingId: string };
  };
};

export function buildGoogleCalendarEventResource(
  input: GoogleCalendarBooking & { bookingId: string },
): GoogleCalendarEventResource | null {
  if (!googleCalendarTimesAreValid(input)) return null;
  const attendees = calendarCrewAttendees(input.crew);
  return {
    summary: googleCalendarEventTitle(input),
    location: input.location || "Location TBD",
    description: googleCalendarEventDescription(input),
    start: { dateTime: new Date(input.startAt).toISOString() },
    end: { dateTime: new Date(input.endAt).toISOString() },
    ...(attendees.length ? { attendees, guestsCanInviteOthers: false } : {}),
    extendedProperties: {
      private: { crmBookingId: input.bookingId },
    },
  };
}

export function buildGoogleCalendarUrl(input: GoogleCalendarBooking) {
  if (!googleCalendarTimesAreValid(input)) return null;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: googleCalendarEventTitle(input),
    dates: `${googleDate(input.startAt)}/${googleDate(input.endAt)}`,
    location: input.location || "Location TBD",
    details: googleCalendarEventDescription(input),
  });
  const attendees = calendarCrewAttendees(input.crew);
  for (const attendee of attendees) {
    params.append("add", attendee.email);
  }
  return `https://calendar.google.com/calendar/render?${params}`;
}
