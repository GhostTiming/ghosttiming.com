import {
  unqualifiedReasonLabels,
  unqualifiedReasons,
  validateUnqualifiedDetails,
  type UnqualifiedReason,
} from "./domain";
import { uniqueNormalizedEmails } from "../google/email-match";

export type OutreachRecordKind = "prospect" | "booking";

export type OutreachParticipant = {
  email: string;
  name?: string | null;
  source: "contact" | "person" | "extra";
};

export type MeetingCalendarResult = {
  googleCalendarId: string;
  googleEventId: string;
  htmlLink?: string | null;
  hangoutLink?: string | null;
};

export type MeetingWrapUp =
  | {
      outcome: "qualified";
      notes: string;
      wrappedAt: string;
      wrappedBy: string;
    }
  | {
      outcome: "unqualified";
      notes: string;
      unqualifiedReason: UnqualifiedReason;
      wrappedAt: string;
      wrappedBy: string;
    }
  | {
      outcome: "notes";
      notes: string;
      wrappedAt: string;
      wrappedBy: string;
    };

export type MeetingActivityMetadata = {
  subject: string;
  startsAt: string;
  durationMinutes: number;
  attendees: string[];
  includeGoogleMeet: boolean;
  agenda?: string;
  googleCalendarId?: string;
  googleEventId?: string;
  htmlLink?: string | null;
  hangoutLink?: string | null;
  wrapUp?: MeetingWrapUp;
};

export const DEFAULT_MEETING_DURATION_MINUTES = 30;
export const MAX_MEETING_DURATION_MINUTES = 24 * 60;

export function parseMeetingDurationMinutes(value: unknown) {
  const minutes = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MEETING_DURATION_MINUTES) {
    throw new Error("Enter the meeting length in minutes (1–1440).");
  }
  return minutes;
}

export function parseMeetingStart(value: string) {
  const start = new Date(value);
  if (Number.isNaN(start.valueOf())) {
    throw new Error("Choose a meeting date and time.");
  }
  return start;
}

export function meetingEndsAt(startsAt: Date, durationMinutes: number) {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

export function parseMeetingAttendees(
  ...groups: Array<string | null | undefined | Array<string | null | undefined>>
) {
  return uniqueNormalizedEmails(...groups);
}

export function defaultMeetingSubject(recordTitle: string) {
  const title = recordTitle.trim() || "Ghost Timing";
  return `Meeting · ${title}`;
}

export function formatMeetingWhen(startsAt: string, durationMinutes: number) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.valueOf())) return `${durationMinutes} min`;
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(start);
  return `${formatted} · ${durationMinutes} min`;
}

export function formatMeetingActivityBody(input: {
  subject: string;
  startsAt: string;
  durationMinutes: number;
  attendees: string[];
  agenda?: string;
  hangoutLink?: string | null;
  htmlLink?: string | null;
}) {
  const lines = [
    input.subject.trim() || "Meeting",
    `When: ${formatMeetingWhen(input.startsAt, input.durationMinutes)}`,
    `Attendees: ${input.attendees.length ? input.attendees.join(", ") : "Organizer only"}`,
  ];
  if (input.hangoutLink) lines.push(`Google Meet: ${input.hangoutLink}`);
  if (input.htmlLink) lines.push(`Calendar: ${input.htmlLink}`);
  const agenda = input.agenda?.trim();
  if (agenda) lines.push("", "Agenda:", agenda);
  return lines.join("\n");
}

export function parseMeetingMetadata(
  metadata: unknown,
): MeetingActivityMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meeting = "meeting" in metadata ? metadata.meeting : null;
  if (!meeting || typeof meeting !== "object") return null;
  const record = meeting as Record<string, unknown>;
  const subject = String(record.subject ?? "").trim();
  const startsAt = String(record.startsAt ?? "");
  const attendees = Array.isArray(record.attendees)
    ? parseMeetingAttendees(record.attendees.map((item) => String(item)))
    : [];
  const durationMinutes = Number(record.durationMinutes);
  if (!subject || Number.isNaN(new Date(startsAt).valueOf()) || !Number.isInteger(durationMinutes)) {
    return null;
  }
  return {
    subject,
    startsAt,
    durationMinutes,
    attendees,
    includeGoogleMeet: Boolean(record.includeGoogleMeet),
    agenda: typeof record.agenda === "string" && record.agenda.trim()
      ? record.agenda.trim()
      : undefined,
    googleCalendarId:
      typeof record.googleCalendarId === "string" ? record.googleCalendarId : undefined,
    googleEventId:
      typeof record.googleEventId === "string" ? record.googleEventId : undefined,
    htmlLink: typeof record.htmlLink === "string" ? record.htmlLink : null,
    hangoutLink: typeof record.hangoutLink === "string" ? record.hangoutLink : null,
    wrapUp: parseMeetingWrapUp(record.wrapUp),
  };
}

function parseMeetingWrapUp(value: unknown): MeetingWrapUp | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const notes = String(record.notes ?? "").trim();
  const wrappedAt = String(record.wrappedAt ?? "");
  const wrappedBy = String(record.wrappedBy ?? "").trim();
  if (!notes || !wrappedBy || Number.isNaN(new Date(wrappedAt).valueOf())) return undefined;
  if (record.outcome === "qualified") {
    return { outcome: "qualified", notes, wrappedAt, wrappedBy };
  }
  if (record.outcome === "unqualified") {
    const reason = String(record.unqualifiedReason ?? "");
    if (!unqualifiedReasons.includes(reason as UnqualifiedReason)) return undefined;
    return {
      outcome: "unqualified",
      notes,
      unqualifiedReason: reason as UnqualifiedReason,
      wrappedAt,
      wrappedBy,
    };
  }
  if (record.outcome === "notes") {
    return { outcome: "notes", notes, wrappedAt, wrappedBy };
  }
  return undefined;
}

export function wrapUpLabel(wrapUp: MeetingWrapUp) {
  if (wrapUp.outcome === "qualified") return "Qualified";
  if (wrapUp.outcome === "unqualified") {
    return `Unqualified · ${unqualifiedReasonLabels[wrapUp.unqualifiedReason]}`;
  }
  return "Wrapped up";
}

export function validateMeetingWrapUpInput(input: {
  recordKind: OutreachRecordKind;
  notes: string;
  outcome?: string;
  unqualifiedReason?: string | null;
}) {
  const notes = input.notes.trim();
  if (!notes) return { success: false as const, error: "Describe what happened in the meeting." };
  if (input.recordKind === "booking") {
    return {
      success: true as const,
      data: { outcome: "notes" as const, notes },
    };
  }
  if (input.outcome === "qualified") {
    return {
      success: true as const,
      data: { outcome: "qualified" as const, notes },
    };
  }
  if (input.outcome === "unqualified") {
    const result = validateUnqualifiedDetails({
      reason: input.unqualifiedReason,
      note: notes,
    });
    if (!result.success) return result;
    return {
      success: true as const,
      data: {
        outcome: "unqualified" as const,
        notes,
        unqualifiedReason: result.data.reason as UnqualifiedReason,
      },
    };
  }
  return { success: false as const, error: "Choose Qualified or Unqualified." };
}

export function isMeetingActivity(activity: {
  type: string;
  metadata?: unknown;
}) {
  return activity.type === "meeting" || Boolean(parseMeetingMetadata(activity.metadata));
}
