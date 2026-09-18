import { displayUserName } from "./user-profile";
import {
  formatCalendarRaceHeading,
  formatHardwarePointLine,
  type CalendarRace,
} from "./google-calendar";
import {
  formatAgeGroupsField,
  formatAwardDepth,
  formatAwardsField,
  scoringFromLegacyText,
  type AgeBand,
  type RaceScoring,
} from "./race-scoring";
import {
  applyEmailTemplate,
  escapeHtml,
  type EmailTemplateValue,
} from "./email-placeholders";

export const DEFAULT_CREW_EMAIL_NAME = "Remote crew notes";
export const DEFAULT_CREW_EMAIL_SUBJECT = "{{event_name}} — race-day crew notes";
export const CREW_EMAIL_LOGO_URL =
  "https://d368g9lw5ileu7.cloudfront.net/uploads/generic/genericImage-websiteLogo-252044-1761776254.5181-0.bPaPj-.jpg";

export const DEFAULT_CREW_EMAIL_HTML = `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">
  Event details, programming notes, race-day order of operations, and quick help center links.
</div>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f7f9;padding:24px 12px">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="640" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.06)">
        <tr>
          <td style="padding:18px 20px;border-bottom:1px solid #e9ecef;text-align:left">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="vertical-align:middle;text-align:left">
                  <img src="${CREW_EMAIL_LOGO_URL}" width="64" alt="Ghost Timing &amp; Event Support" style="display:block;border:0;outline:none;text-decoration:none;width:64px;max-width:64px;height:auto">
                </td>
                <td style="vertical-align:middle;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280">
                  {{crew_notes_label}}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 20px 8px 20px;font-family:Arial,Helvetica,sans-serif;color:#111827;text-align:left">
            <div style="font-size:22px;line-height:30px;font-weight:700;color:#111827">{{event_name}}</div>
            <div style="font-size:14px;line-height:22px;margin-top:10px;color:#374151">Hi team,</div>
            <div style="font-size:14px;line-height:22px;margin-top:10px;color:#374151">
              Below are the key details for race day, including programming notes, event setup details, timing order of operations, and quick help resources.
            </div>
            <div style="font-size:14px;line-height:22px;margin-top:10px;color:#374151"><b>Please reply to acknowledge you received this email.</b></div>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 20px 10px 20px">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e9ecef;border-radius:10px">
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Event Summary</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 14px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111827">
                  <div style="padding:0 0 10px 0"><strong>Event Name:</strong> {{event_name}}</div>
                  <div style="padding:0 0 10px 0"><strong>Race Registration Website:</strong> {{registration_link}}</div>
                  <div><strong>When Timer Will Be Online:</strong> {{timer_online_at}}</div>
                </td>
              </tr>
            </table>
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e9ecef;border-radius:10px;margin-top:10px">
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Timer Information</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 14px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111827">
                  <div style="padding:0 0 10px 0"><strong>Timer Name:</strong> {{timer_name}}</div>
                  <div style="padding:0 0 10px 0"><strong>Timer Cell Phone:</strong> {{timer_phone_link}}</div>
                  <div><strong>Timer Email:</strong> {{timer_email}}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 10px 20px">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e9ecef;border-radius:10px">
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Event Name to Program</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 14px 14px;font-family:Arial,Helvetica,sans-serif">
                  <div style="background:#f9fafb;border:1px solid #eef2f7;border-radius:8px;padding:10px 12px;font-size:14px;line-height:20px;color:#111827;white-space:pre-line">{{event_name_to_program}}</div>
                </td>
              </tr>
              <tr><td style="border-top:1px solid #e9ecef"></td></tr>
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Start / Split / Finish Locations and Point Name to Program</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 14px 14px;font-family:Arial,Helvetica,sans-serif">
                  <div style="background:#f9fafb;border:1px solid #eef2f7;border-radius:8px;padding:10px 12px;font-size:14px;line-height:20px;color:#111827;white-space:pre-line">{{course_points}}</div>
                </td>
              </tr>
              <tr><td style="border-top:1px solid #e9ecef"></td></tr>
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Distances and Start Times</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 14px 14px;font-family:Arial,Helvetica,sans-serif">
                  <div style="background:#f9fafb;border:1px solid #eef2f7;border-radius:8px;padding:10px 12px;font-size:14px;line-height:20px;color:#111827;white-space:pre-line">{{distances_and_start_times}}</div>
                </td>
              </tr>
              <tr><td style="border-top:1px solid #e9ecef"></td></tr>
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Awards and Age Groups Programmed</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 14px 14px;font-family:Arial,Helvetica,sans-serif">
                  <div style="background:#f9fafb;border:1px solid #eef2f7;border-radius:8px;padding:10px 12px;font-size:14px;line-height:20px;color:#111827;white-space:pre-line">{{awards_and_age_groups}}</div>
                </td>
              </tr>
              <tr><td style="border-top:1px solid #e9ecef"></td></tr>
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Additional Expectations</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 16px 14px;font-family:Arial,Helvetica,sans-serif">
                  <div style="background:#f9fafb;border:1px solid #eef2f7;border-radius:8px;padding:10px 12px;font-size:14px;line-height:20px;color:#111827;white-space:pre-line">{{additional_expectations}}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 10px 20px">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e9ecef;border-radius:10px">
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Best Practices for Race Morning</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 16px 14px;font-family:Arial,Helvetica,sans-serif">
                  <div style="background:#f9fafb;border:1px solid #eef2f7;border-radius:8px;padding:12px;font-size:14px;line-height:22px;color:#111827">
                    <strong>Order of operations matters.</strong> Please work through setup in this order:<br><br>
                    1. <strong>Connect to the cellular network</strong> as soon as programming event/point is complete<br>
                    2. <strong>Set the time on the box and mini box</strong>, or AeroTrack if applicable<br>
                    3. <strong>Program the event name and point name</strong><br>
                    4. <strong>Connect to the server once cellular, time setup, and programming are complete</strong><br>
                    5. <strong>Contact the timer immediately</strong> once all steps above have been completed
                    <br><br><strong>A few important notes:</strong>
                    <ul>
                      <li>During time setup, after setting the correct time, press the running clock and select <b>Broadcast</b> to sync with Mini</li>
                      <li>If you do <b>not</b> hear a beep when broadcasting, the boxes are not communicating. Refer to <b>Mini LAN Fix</b> in the help center (link below)</li>
                      <li>Server connection should be the final setup step before contacting the timer.</li>
                    </ul>
                    <b>The biggest priority is getting online as soon as possible after those setup steps are done.</b>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 10px 20px">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e9ecef;border-radius:10px">
              <tr>
                <td style="padding:14px 14px 6px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.02em;color:#6b7280;text-transform:uppercase"><b>Help Center</b></td>
              </tr>
              <tr>
                <td style="padding:0 14px 12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#111827">
                  <b>Full help center:
                    <a href="https://ghosttiming.com/help_center.html" style="color:#111827;text-decoration:underline">ghosttiming.com/help_center.html</a>
                  </b>
                </td>
              </tr>
              <tr>
                <td style="padding:0 14px 16px 14px">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif">
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;background:#f9fafb;font-size:13px;font-weight:700;color:#111827">Topic</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;background:#f9fafb;font-size:13px;font-weight:700;color:#111827">Quick Reference</td>
                    </tr>
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#111827">Cellular Server Connect</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#374151">Use this if the controller needs to get online over cellular.</td>
                    </tr>
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#111827">Set Event Name</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#374151">Program the correct event name provided for this race.</td>
                    </tr>
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#111827">Set NTP Time</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#374151">Sync time first so devices are aligned before going online.</td>
                    </tr>
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#111827">Mini LAN Fix</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#374151">Use this when the mini and Pro2 are not seeing each other properly.</td>
                    </tr>
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#111827">Mini Track Clear Message</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#374151">Use this when the mini will not stop beeping and has a message that needs cleared.</td>
                    </tr>
                    <tr>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#111827">Emergency Wifi Server Connect</td>
                      <td style="padding:10px;border:1px solid #e5e7eb;font-size:13px;color:#374151">Emergency backup option for getting connected if primary methods fail.</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 20px 22px 20px;font-family:Arial,Helvetica,sans-serif;color:#374151;text-align:left">
            <div style="font-size:14px;line-height:22px">Please reach out as soon as setup is complete or if anything looks off.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 20px;background:#111827;font-family:Arial,Helvetica,sans-serif;color:#ffffff;text-align:left">
            <div style="font-size:12px;line-height:18px;opacity:0.9">{{organization_name}}</div>
          </td>
        </tr>
      </table>
      <div style="height:18px;line-height:18px">&nbsp;</div>
    </td>
  </tr>
</table>
`;

const unset = "Not set";

export type CrewEmailRace = CalendarRace & {
  scoring?: RaceScoring | unknown;
  legacyAgeGroups?: string | null;
  legacyAwards?: string | null;
};

export type CrewEmailCoursePoint = {
  name: string;
  hardwarePointName?: string | null;
  notes?: string | null;
};

export type CrewEmailBooking = {
  eventName: string;
  registrationUrl?: string | null;
  timerOnlineAt?: string | null;
  timerLocation?: string | null;
  organizationName?: string | null;
  hardwareEventName?: string | null;
  scoringExpectations?: string | null;
  postEventExpectations?: string | null;
  operationsNotes?: string | null;
  races: CrewEmailRace[];
  coursePoints: CrewEmailCoursePoint[];
};

export type CrewEmailTimer = {
  name: string;
  phone?: string | null;
  email?: string | null;
};

function orUnset(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || unset;
}

function joinBlocks(blocks: Array<string | null | undefined>, empty = unset) {
  const lines = blocks.map((block) => block?.trim()).filter((block): block is string => Boolean(block));
  return lines.length ? lines.join("\n\n") : empty;
}

export function formatCrewEmailDateTime(value?: string | null) {
  if (!value) return unset;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return orUnset(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

export function formatCrewNotesLabel(timerLocation?: string | null) {
  if (timerLocation === "remote") return "Remote crew notes";
  if (timerLocation === "on_site") return "On-site crew notes";
  return "Crew notes";
}

export function formatCrewCoursePoints(points: CrewEmailCoursePoint[]) {
  if (!points.length) return unset;
  return points.map((point) => formatHardwarePointLine(point)).filter(Boolean).join("\n");
}

export function formatCrewDistances(races: CrewEmailRace[]) {
  if (!races.length) return unset;
  return races.map((race) => formatCalendarRaceHeading(race)).join("\n");
}

function scoringForRace(race: CrewEmailRace) {
  return scoringFromLegacyText({
    scoring: race.scoring,
    ageGroups: race.legacyAgeGroups ?? race.ageGroups,
    awards: race.legacyAwards ?? race.awards,
  });
}

function formatImpliedAwards(bands: AgeBand[]) {
  const depths = [
    ...new Set(bands.map((band) => formatAwardDepth(band.awardDepth)).filter(Boolean)),
  ];
  return depths.length ? depths.join("\n") : null;
}

export function formatCrewAwardsAndAgeGroups(races: CrewEmailRace[]) {
  if (!races.length) return unset;
  const blocks = races.map((race) => {
    const scoring = scoringForRace(race);
    const heading = formatCalendarRaceHeading(race);
    const ageGroups = formatAgeGroupsField(scoring.ageGroups);
    const awards =
      formatAwardsField(scoring.awards) ?? formatImpliedAwards(scoring.ageGroups);
    const lines = [heading];
    if (awards) lines.push(`Awards:\n${awards}`);
    if (ageGroups) lines.push(`Age groups:\n${ageGroups}`);
    if (scoring.notes?.trim()) lines.push(scoring.notes.trim());
    if (lines.length === 1) lines.push("No age groups or awards entered.");
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

export function formatCrewEventNameToProgram(hardwareEventName?: string | null) {
  return hardwareEventName?.trim() || "";
}

export function formatCrewHardwareNames(input: {
  hardwareEventName?: string | null;
  coursePoints: CrewEmailCoursePoint[];
}) {
  return formatCrewEventNameToProgram(input.hardwareEventName);
}

export function formatCrewAdditionalExpectations(input: {
  scoringExpectations?: string | null;
  postEventExpectations?: string | null;
  operationsNotes?: string | null;
}) {
  return joinBlocks(
    [
      input.scoringExpectations?.trim()
        ? `Scoring/support:\n${input.scoringExpectations.trim()}`
        : null,
      input.postEventExpectations?.trim()
        ? `Post-event:\n${input.postEventExpectations.trim()}`
        : null,
      input.operationsNotes?.trim() ? `Operations notes:\n${input.operationsNotes.trim()}` : null,
    ],
    "",
  );
}

export function formatTimerPhone(phone?: string | null) {
  const trimmed = phone?.trim() || "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return trimmed;
}

export function timerPhoneHref(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits || "";
}

export function crewEmailTimerFromUser(user: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}): CrewEmailTimer {
  return {
    name: displayUserName({
      firstName: user.firstName,
      lastName: user.lastName,
      fallback: user.name || user.email,
    }),
    phone: user.phone,
    email: user.email,
  };
}

function linkHtml(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="color:#111827;text-decoration:underline">${escapeHtml(label)}</a>`;
}

export function buildCrewEmailValues(
  booking: CrewEmailBooking,
  timer: CrewEmailTimer,
): Record<string, EmailTemplateValue> {
  const registrationUrl = booking.registrationUrl?.trim() || "";
  const phone = formatTimerPhone(timer.phone);
  const tel = timerPhoneHref(timer.phone);
  return {
    event_name: orUnset(booking.eventName),
    registration_url: orUnset(registrationUrl),
    registration_link: {
      html: registrationUrl ? linkHtml(registrationUrl, registrationUrl) : escapeHtml(unset),
    },
    timer_online_at: formatCrewEmailDateTime(booking.timerOnlineAt),
    course_points: formatCrewCoursePoints(booking.coursePoints),
    distances_and_start_times: formatCrewDistances(booking.races),
    awards_and_age_groups: formatCrewAwardsAndAgeGroups(booking.races),
    event_name_to_program: formatCrewEventNameToProgram(booking.hardwareEventName),
    hardware_names: formatCrewEventNameToProgram(booking.hardwareEventName),
    additional_expectations: formatCrewAdditionalExpectations(booking),
    timer_name: orUnset(timer.name),
    timer_phone: orUnset(phone),
    timer_phone_link: {
      html: tel ? linkHtml(`tel:${tel}`, phone || tel) : escapeHtml(orUnset(phone)),
    },
    timer_email: orUnset(timer.email),
    organization_name: orUnset(booking.organizationName),
    crew_notes_label: formatCrewNotesLabel(booking.timerLocation),
    logo_url: CREW_EMAIL_LOGO_URL,
  };
}

export function renderCrewEmailTemplate(
  template: { subject: string; bodyHtml: string },
  booking: CrewEmailBooking,
  timer: CrewEmailTimer,
) {
  const values = buildCrewEmailValues(booking, timer);
  return {
    subject: applyEmailTemplate(template.subject, values),
    html: applyEmailTemplate(template.bodyHtml, values),
  };
}
