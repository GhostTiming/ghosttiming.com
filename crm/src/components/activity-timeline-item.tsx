import { AddressListMailto } from "@/components/crm-links";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  isEmailTimelineActivity,
  parseEmailActivityBody,
  timelineLabel,
  type TimelineEventType,
} from "@/lib/crm/domain";
import {
  formatMeetingWhen,
  parseMeetingMetadata,
  wrapUpLabel,
} from "@/lib/crm/outreach-activity";

export type TimelineActivity = {
  id: string;
  type: string;
  occurred_at: string;
  body: string;
  disposition?: string | null;
  actor_type: string;
  actor_name: string;
  metadata?: {
    eventType?: TimelineEventType | string;
    source?: string;
    gmailMessageId?: string;
    gmailThreadId?: string;
    rfcMessageId?: string;
    meeting?: unknown;
  } | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function provenance(activity: TimelineActivity) {
  if (activity.metadata?.source === "gmail") return "Gmail Sync";
  if (activity.actor_type === "ai") return activity.actor_name || "Claude / AI";
  if (activity.actor_type === "system") return activity.actor_name || "System";
  return activity.actor_name || "Human";
}

function EmailActivityBody({ body }: { body: string }) {
  const parsed = parseEmailActivityBody(body);
  const summary = parsed.subject ?? "View email";
  return (
    <details className="group mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-cyan-700 hover:text-cyan-900 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-slate-400 transition group-open:rotate-180"
        />
      </summary>
      <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <dl className="grid gap-1">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Subject
            </dt>
            <dd>{parsed.subject ?? "(none)"}</dd>
          </div>
          {parsed.from ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                From
              </dt>
              <dd><AddressListMailto value={parsed.from} className="text-cyan-700 underline hover:text-cyan-900" /></dd>
            </div>
          ) : null}
          {parsed.to ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                To
              </dt>
              <dd><AddressListMailto value={parsed.to} className="text-cyan-700 underline hover:text-cyan-900" /></dd>
            </div>
          ) : null}
          {parsed.cc ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Cc
              </dt>
              <dd><AddressListMailto value={parsed.cc} className="text-cyan-700 underline hover:text-cyan-900" /></dd>
            </div>
          ) : null}
        </dl>
        <p className="whitespace-pre-wrap border-t border-slate-200 pt-2">
          {parsed.body || "(No message body stored)"}
        </p>
      </div>
    </details>
  );
}

export function ActivityTimelineItem({
  activity,
  replyHref,
  actions,
}: {
  activity: TimelineActivity;
  replyHref?: string;
  actions?: ReactNode;
}) {
  const gmail = activity.metadata?.source === "gmail";
  const email = isEmailTimelineActivity(activity);
  const meeting = parseMeetingMetadata(activity.metadata);
  return (
    <article className={`border-l-2 pl-4 ${gmail ? "border-blue-400" : "border-cyan-200"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{timelineLabel(activity)}</strong>
        {gmail ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
            Gmail
          </span>
        ) : null}
        {meeting?.wrapUp ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            {wrapUpLabel(meeting.wrapUp)}
          </span>
        ) : meeting ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Invite sent
          </span>
        ) : null}
        <span className="text-slate-500">{formatDateTime(activity.occurred_at)}</span>
        {activity.disposition ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{activity.disposition}</span>
        ) : null}
        {replyHref ? (
          <a
            href={replyHref}
            className="text-xs font-semibold text-cyan-700 hover:text-cyan-900"
          >
            Reply
          </a>
        ) : null}
      </div>
      {meeting ? (
        <div className="mt-1 space-y-1 text-sm text-slate-700">
          <p className="font-medium">{meeting.subject}</p>
          <p>{formatMeetingWhen(meeting.startsAt, meeting.durationMinutes)}</p>
          <p>
            Attendees:{" "}
            {meeting.attendees.length ? (
              <AddressListMailto
                value={meeting.attendees.join(", ")}
                className="text-cyan-700 underline hover:text-cyan-900"
              />
            ) : (
              "Organizer only"
            )}
          </p>
          {meeting.hangoutLink ? (
            <p>
              <a
                href={meeting.hangoutLink}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-cyan-700 hover:text-cyan-900"
              >
                Google Meet
              </a>
            </p>
          ) : null}
          {meeting.htmlLink ? (
            <p>
              <a
                href={meeting.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-700 underline hover:text-cyan-900"
              >
                Open calendar event
              </a>
            </p>
          ) : null}
          {meeting.agenda ? (
            <p className="whitespace-pre-wrap">{meeting.agenda}</p>
          ) : null}
          {meeting.wrapUp ? (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Wrap-up
              </p>
              <p className="mt-1 font-medium">{wrapUpLabel(meeting.wrapUp)}</p>
              <p className="mt-1 whitespace-pre-wrap">{meeting.wrapUp.notes}</p>
            </div>
          ) : null}
        </div>
      ) : email ? (
        <EmailActivityBody body={activity.body} />
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{activity.body}</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {provenance(activity)} · {activity.actor_type}
      </p>
      {actions}
    </article>
  );
}
