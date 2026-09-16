import { ChevronDown } from "lucide-react";
import {
  isEmailTimelineActivity,
  parseEmailActivityBody,
  timelineLabel,
  type TimelineEventType,
} from "@/lib/crm/domain";

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
              <dd>{parsed.from}</dd>
            </div>
          ) : null}
          {parsed.to ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                To
              </dt>
              <dd>{parsed.to}</dd>
            </div>
          ) : null}
          {parsed.cc ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Cc
              </dt>
              <dd>{parsed.cc}</dd>
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

export function ActivityTimelineItem({ activity }: { activity: TimelineActivity }) {
  const gmail = activity.metadata?.source === "gmail";
  const email = isEmailTimelineActivity(activity);
  return (
    <article className={`border-l-2 pl-4 ${gmail ? "border-blue-400" : "border-cyan-200"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{timelineLabel(activity)}</strong>
        {gmail ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
            Gmail
          </span>
        ) : null}
        <span className="text-slate-500">{formatDateTime(activity.occurred_at)}</span>
        {activity.disposition ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{activity.disposition}</span>
        ) : null}
      </div>
      {email ? (
        <EmailActivityBody body={activity.body} />
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{activity.body}</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {provenance(activity)} · {activity.actor_type}
      </p>
    </article>
  );
}
