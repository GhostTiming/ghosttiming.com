import { normalizeEmail } from "../contact-extraction/extract";

export type CalendarRace = {
  name: string;
  distanceLabel?: string | null;
  startTime?: string | null;
  ageGroups?: string | null;
  awards?: string | null;
  notes?: string | null;
};

export type CalendarCrewMember = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
};

export type CalendarCoursePoint = {
  name: string;
  hardwarePointName?: string | null;
};

export type GoogleCalendarBooking = {
  year: number | null;
  eventName: string;
  startAt: string;
  endAt: string;
  location: string;
  registrationUrl?: string | null;
  hardwareEventName?: string | null;
  coursePoints?: CalendarCoursePoint[];
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
  return `${hours}:${minutes}${period}`;
}

function calendarFieldLines(value?: string | null) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length);
}

export function formatCalendarLabeledField(label: string, items: string[]) {
  return [`${label}:`, ...items].join("\n");
}

export function formatCalendarMultilineField(
  label: string,
  value?: string | null,
) {
  const lines = calendarFieldLines(value);
  return formatCalendarLabeledField(label, lines.length ? lines : ["Not set"]);
}

export const DEFAULT_CALENDAR_CREW_MEMBER: CalendarCrewMember = {
  name: "Michelle Splitstone-Laloggia",
  phone: "(407) 687-2570",
};

function isDefaultCalendarCrewMember(member: CalendarCrewMember) {
  return member.name.trim().toLowerCase().includes("splitstone");
}

export function withDefaultCalendarCrew(crew: CalendarCrewMember[]) {
  const hasDefault = crew.some(isDefaultCalendarCrewMember);
  if (hasDefault) {
    return crew.map((member) =>
      isDefaultCalendarCrewMember(member)
        ? {
            ...member,
            phone: member.phone?.trim() || DEFAULT_CALENDAR_CREW_MEMBER.phone,
          }
        : member,
    );
  }
  return [DEFAULT_CALENDAR_CREW_MEMBER, ...crew];
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

function optionalCalendarField(label: string, value?: string | null) {
  const lines = calendarFieldLines(value);
  if (!lines.length) return null;
  return formatCalendarLabeledField(label, lines);
}

export function formatCalendarRaceHeading(race: CalendarRace) {
  const title =
    race.distanceLabel && race.distanceLabel !== race.name
      ? `${race.name} (${race.distanceLabel})`
      : race.name;
  return `${title} @ ${formatCalendarRaceClock(race.startTime)} Start`;
}

export function formatHardwarePointLine(point: CalendarCoursePoint) {
  const location = point.name.trim();
  const hardware = point.hardwarePointName?.trim() || "";
  if (location && hardware) return `${location} • Point name: ${hardware}`;
  if (hardware) return `Point name: ${hardware}`;
  return location;
}

export function formatCalendarHardwareFields(input: {
  hardwareEventName?: string | null;
  coursePoints?: CalendarCoursePoint[];
}) {
  const eventName = input.hardwareEventName?.trim();
  const points = (input.coursePoints ?? [])
    .map((point) => formatHardwarePointLine(point))
    .filter(Boolean);
  return [
    eventName ? formatCalendarLabeledField("Event Name to Program", [eventName]) : null,
    points.length
      ? formatCalendarLabeledField(
          "Start / Split / Finish Locations and Point Name to Program",
          points,
        )
      : null,
  ].filter((block): block is string => Boolean(block));
}

function raceDescription(race: CalendarRace) {
  return [
    formatCalendarRaceHeading(race),
    optionalCalendarField("Age Groups", race.ageGroups),
    optionalCalendarField("Awards", race.awards),
    optionalCalendarField("Notes", race.notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const CRM_BOOKING_PRIVATE_PROPERTY = "crmBookingId";

export function googleCalendarEventTitle(input: GoogleCalendarBooking) {
  return `${input.year ?? ""} ${input.eventName}`.trim();
}

export function googleCalendarEventDescription(input: GoogleCalendarBooking) {
  const crewLabels = withDefaultCalendarCrew(input.crew)
    .map((member) => calendarCrewDescriptionLine(member))
    .filter(Boolean);
  return [
    formatCalendarLabeledField("Race Registration", [
      input.registrationUrl || "Not set",
    ]),
    formatCalendarLabeledField(
      "Crew",
      crewLabels.length ? crewLabels : ["None assigned"],
    ),
    formatCalendarLabeledField(
      "Race(s)",
      input.races.length
        ? [input.races.map(raceDescription).join("\n\n")]
        : ["No races entered"],
    ),
    ...formatCalendarHardwareFields(input),
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
