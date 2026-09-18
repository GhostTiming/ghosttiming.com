export const outreachActivityTypes = ["phone_call", "email", "meeting"] as const;
export const activityTypes = [...outreachActivityTypes, "note"] as const;
export const timelineEventTypes = [
  "email_out",
  "email_in",
  "call_out",
  "call_in",
  "meeting",
  "other",
] as const;

export type UserActivityType = (typeof activityTypes)[number];
export type TimelineEventType = (typeof timelineEventTypes)[number];

export const dispositions = [
  "No Answer",
  "Left Voicemail",
  "No Voicemail",
  "Interested",
  "Meeting Set",
  "Event Canceled",
  "Already Booked",
  "Timing Company",
  "Not Interested",
  "Do Not Contact",
  "Bad Timing / Try Again",
  "Bad Contact Information",
  "Other",
] as const;

const terminalDispositions = new Set<string>([
  "Event Canceled",
  "Already Booked",
  "Not Interested",
  "Do Not Contact",
]);

export function isOutreachActivity(type: string): boolean {
  return (outreachActivityTypes as readonly string[]).includes(type);
}

export function countTouches(activityTypeValues: readonly string[]): number {
  return activityTypeValues.filter(isOutreachActivity).length;
}

export const closedProspectStageKeys = [
  "closed_lost",
  "disqualified",
  "unqualified",
  "past_event",
] as const;

export const prospectListOutcomeStages = [
  { key: "closed_lost", label: "Close lost" },
  { key: "disqualified", label: "Disqualify" },
  { key: "unqualified", label: "Unqualified" },
  { key: "past_event", label: "Passed event" },
] as const;

export const closedLostReasons = [
  "went_with_another_timer",
  "event_cancelled",
  "no_decision",
  "other",
] as const;

export type ClosedLostReason = (typeof closedLostReasons)[number];

export const closedLostReasonLabels: Record<ClosedLostReason, string> = {
  went_with_another_timer: "Went with another timer",
  event_cancelled: "Event cancelled",
  no_decision: "No decision",
  other: "Other",
};

export const unqualifiedReasons = [
  "event_too_soon",
  "already_has_timer",
  "untimed_event",
  "no_need",
  "other",
] as const;
export type UnqualifiedReason = (typeof unqualifiedReasons)[number];
export const unqualifiedReasonLabels: Record<UnqualifiedReason, string> = {
  event_too_soon: "Event too soon",
  already_has_timer: "Already has a timer",
  untimed_event: "Untimed event",
  no_need: "No need",
  other: "Other",
};

export const disqualifiedReasons = [
  "is_a_timing_company",
  "blacklisted_email",
  "do_not_contact",
  "race_canceled",
  "other",
] as const;
export type DisqualifiedReason = (typeof disqualifiedReasons)[number];
export const disqualifiedReasonLabels: Record<DisqualifiedReason, string> = {
  is_a_timing_company: "Is a timing company",
  blacklisted_email: "Blacklisted email",
  do_not_contact: "Do not contact",
  race_canceled: "Race canceled",
  other: "Other",
};

export const emailBlacklistReasons = [
  "is_a_timing_company",
  "blacklisted_email",
  "other",
] as const;

export const bookingPipelineStageKeys = [
  "awaiting_decision",
  "confirmed",
  "pre_event_prep",
  "ready",
  "completed",
  "paid",
  "closed_lost",
] as const;

export const prospectPipelineStageKeys = [
  "cold",
  "scoping",
  "confirmed",
  "closed_lost",
  "disqualified",
  "unqualified",
  "past_event",
] as const;

export const prospectPipelineStageLabels: Record<
  (typeof prospectPipelineStageKeys)[number],
  string
> = {
  cold: "Contacting",
  scoping: "Scoping",
  confirmed: "Confirmed",
  closed_lost: "Closed lost",
  disqualified: "Disqualified",
  unqualified: "Unqualified",
  past_event: "Past event",
};

export const destructiveProspectStageKeys = [
  "closed_lost",
  "disqualified",
  "unqualified",
  "past_event",
] as const;

export type ClosedLostDetails = {
  reason: ClosedLostReason;
  note: string | null;
  circleBackOn: string | null;
};

export function isClosedLostReason(value: string): value is ClosedLostReason {
  return (closedLostReasons as readonly string[]).includes(value);
}

export function isUnqualifiedReason(value: string): value is UnqualifiedReason {
  return (unqualifiedReasons as readonly string[]).includes(value);
}

export function isDisqualifiedReason(value: string): value is DisqualifiedReason {
  return (disqualifiedReasons as readonly string[]).includes(value);
}

export type OutcomeReasonDetails = {
  reason: string;
  note: string | null;
};

function validateOutcomeReasonDetails(
  input: { reason?: string | null; note?: string | null },
  options: {
    allowed: readonly string[];
    missing: string;
    invalid: string;
  },
): { success: true; data: OutcomeReasonDetails } | { success: false; error: string } {
  const reason = input.reason?.trim() ?? "";
  if (!reason) return { success: false, error: options.missing };
  if (!options.allowed.includes(reason)) {
    return { success: false, error: options.invalid };
  }
  const note = input.note?.trim() || null;
  if (reason === "other" && !note) {
    return { success: false, error: "Add a note for Other." };
  }
  return { success: true, data: { reason, note } };
}

export function validateUnqualifiedDetails(input: {
  reason?: string | null;
  note?: string | null;
}) {
  return validateOutcomeReasonDetails(input, {
    allowed: unqualifiedReasons,
    missing: "Choose why this prospect is unqualified.",
    invalid: "Choose a valid unqualified reason.",
  });
}

export function parseUnqualifiedDetails(input: {
  reason?: string | null;
  note?: string | null;
}): OutcomeReasonDetails {
  const result = validateUnqualifiedDetails(input);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export function validateDisqualifiedDetails(input: {
  reason?: string | null;
  note?: string | null;
}) {
  return validateOutcomeReasonDetails(input, {
    allowed: disqualifiedReasons,
    missing: "Choose why this prospect is disqualified.",
    invalid: "Choose a valid disqualified reason.",
  });
}

export function parseDisqualifiedDetails(input: {
  reason?: string | null;
  note?: string | null;
}): OutcomeReasonDetails {
  const result = validateDisqualifiedDetails(input);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

function parseDateOnly(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { success: true as const, date: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { success: false as const, error: "Circle back must be a date." };
  }
  return { success: true as const, date: trimmed };
}

export function validateClosedLostDetails(input: {
  reason?: string | null;
  note?: string | null;
  circleBackOn?: string | null;
}): { success: true; data: ClosedLostDetails } | { success: false; error: string } {
  const reason = input.reason?.trim() ?? "";
  if (!reason) {
    return { success: false, error: "Choose why this prospect was lost." };
  }
  if (!isClosedLostReason(reason)) {
    return { success: false, error: "Choose a valid lost reason." };
  }
  const note = input.note?.trim() || null;
  if (reason === "other" && !note) {
    return { success: false, error: "Add a note for Other." };
  }
  const circleBackOn = parseDateOnly(input.circleBackOn);
  if (!circleBackOn.success) {
    return { success: false, error: circleBackOn.error };
  }
  return {
    success: true,
    data: {
      reason,
      note,
      circleBackOn: circleBackOn.date,
    },
  };
}

export function parseClosedLostDetails(input: {
  reason?: string | null;
  note?: string | null;
  circleBackOn?: string | null;
}): ClosedLostDetails {
  const result = validateClosedLostDetails(input);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type ClosedProspectStageKey = (typeof closedProspectStageKeys)[number];

export function isClosedProspectStage(stageKey: string | null | undefined): boolean {
  return closedProspectStageKeys.includes(stageKey as ClosedProspectStageKey);
}

export function eventHasAlreadyOccurred(
  eventAt: Date | string | null | undefined,
  now = new Date(),
  timeZone = "America/New_York",
) {
  if (!eventAt) return false;
  const date = eventAt instanceof Date ? eventAt : new Date(eventAt);
  if (Number.isNaN(date.valueOf())) return false;
  const day = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  return day(date) < day(now);
}

export const closedBookingStageKeys = ["closed_lost"] as const;
export const wonBookingStageKeys = ["paid"] as const;

export type PipelineStageTone = "live" | "won" | "lost";

export function bookingStageTone(stageKey: string | null | undefined): PipelineStageTone {
  if (wonBookingStageKeys.includes(stageKey as (typeof wonBookingStageKeys)[number])) {
    return "won";
  }
  if (closedBookingStageKeys.includes(stageKey as (typeof closedBookingStageKeys)[number])) {
    return "lost";
  }
  return "live";
}

export function prospectStageTone(stageKey: string | null | undefined): PipelineStageTone {
  return isClosedProspectStage(stageKey) ? "lost" : "live";
}

export function prospectStageFromLegacyStatus(
  status: string | null | undefined,
): "disqualified" | "unqualified" | null {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("disqualified")) return "disqualified";
  if (normalized.startsWith("unqualified")) return "unqualified";
  return null;
}

export function shouldCloseProspect(disposition: string | null | undefined): boolean {
  return disposition ? terminalDispositions.has(disposition) : false;
}

export function shouldMarkDoNotContact(
  disposition: string | null | undefined,
): boolean {
  return disposition === "Do Not Contact";
}

const timelineEventLabels: Record<TimelineEventType, string> = {
  email_out: "Email Out",
  email_in: "Email In",
  call_out: "Call Out",
  call_in: "Call In",
  meeting: "Meeting",
  other: "Other",
};

const legacyTitleAliases: Record<string, TimelineEventType> = {
  call: "call_out",
  phone: "call_out",
  "phone call": "call_out",
  "call out": "call_out",
  "call in": "call_in",
  "inbound call": "call_in",
  email: "email_out",
  "email out": "email_out",
  "email in": "email_in",
  "inbound email": "email_in",
  meeting: "meeting",
  other: "other",
  note: "other",
};

export function isTimelineEventType(value: string): value is TimelineEventType {
  return (timelineEventTypes as readonly string[]).includes(value);
}

export function eventTypeLabel(type: string): string {
  return isTimelineEventType(type) ? timelineEventLabels[type] : type;
}

export function activityTypeFromEventType(
  eventType: TimelineEventType,
): UserActivityType {
  if (eventType === "email_out" || eventType === "email_in") return "email";
  if (eventType === "call_out" || eventType === "call_in") return "phone_call";
  if (eventType === "meeting") return "meeting";
  return "note";
}

export function parseTaskEventType(title: string): TimelineEventType {
  if (isTimelineEventType(title)) return title;
  return legacyTitleAliases[title.trim().toLowerCase()] ?? "other";
}

export function taskDescription(title: string, notes: string | null | undefined): string {
  if (notes?.trim()) return notes;
  if (isTimelineEventType(title)) return "";
  return title;
}

export function formatTaskHeadline(
  title: string,
  notes?: string | null,
): string {
  const eventType = parseTaskEventType(title);
  const description = taskDescription(title, notes);
  if (isTimelineEventType(title) || legacyTitleAliases[title.trim().toLowerCase()]) {
    return description
      ? `${eventTypeLabel(eventType)}: ${description}`
      : eventTypeLabel(eventType);
  }
  return title;
}

export function taskRecordHref(task: {
  booking_id?: string | null;
  prospect_id?: string | null;
  organization_id?: string | null;
}) {
  if (task.booking_id) return `/bookings/${task.booking_id}`;
  if (task.prospect_id) return `/prospecting/${task.prospect_id}`;
  if (task.organization_id) return `/organizations/${task.organization_id}`;
  return "/tasks";
}

export function formatNextStep(nextStep: string | null | undefined): string | null {
  if (!nextStep) return null;
  return isTimelineEventType(nextStep) ? eventTypeLabel(nextStep) : nextStep;
}

export function latestNonStageActivity<T extends { type: string }>(
  activities: readonly T[],
): T | null {
  return activities.find((activity) => activity.type !== "stage_change") ?? null;
}

export function isEmailTimelineActivity(activity: {
  type: string;
  metadata?: { source?: string; eventType?: string } | null;
}): boolean {
  if (activity.metadata?.source === "gmail") return true;
  if (activity.type === "email") return true;
  const eventType = activity.metadata?.eventType;
  return eventType === "email_in" || eventType === "email_out";
}

export type ParsedEmailActivity = {
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  body: string;
};

export function parseEmailActivityBody(body: string): ParsedEmailActivity {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const headers: Partial<Record<"subject" | "from" | "to" | "cc", string>> = {};
  let index = 0;
  while (index < lines.length) {
    const match = /^(Subject|From|To|Cc):\s*(.*)$/i.exec(lines[index] ?? "");
    if (!match) break;
    const key = match[1].toLowerCase() as "subject" | "from" | "to" | "cc";
    headers[key] = match[2];
    index += 1;
  }
  if (index === 0) {
    return { subject: null, from: null, to: null, cc: null, body };
  }
  if (lines[index] === "") index += 1;
  const subject = headers.subject?.trim() ?? "";
  return {
    subject: !subject || subject === "(none)" ? null : subject,
    from: headers.from?.trim() || null,
    to: headers.to?.trim() || null,
    cc: headers.cc?.trim() || null,
    body: lines.slice(index).join("\n"),
  };
}

export function formatCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function activityEventType(activity: {
  type: string;
  metadata?: { eventType?: string } | null;
}): TimelineEventType {
  const stored = activity.metadata?.eventType;
  if (stored && isTimelineEventType(stored)) return stored;
  if (activity.type === "email") return "email_out";
  if (activity.type === "phone_call") return "call_out";
  if (activity.type === "meeting") return "meeting";
  return "other";
}

export function timelineLabel(activity: {
  type: string;
  metadata?: { eventType?: string } | null;
}): string {
  if (activity.type === "stage_change") return "Stage Change";
  return eventTypeLabel(activityEventType(activity));
}

export function activityLabel(type: string): string {
  return (
    {
      phone_call: "Call Out",
      email: "Email Out",
      meeting: "Meeting",
      note: "Other",
      stage_change: "Stage Change",
    }[type] ?? eventTypeLabel(type)
  );
}
