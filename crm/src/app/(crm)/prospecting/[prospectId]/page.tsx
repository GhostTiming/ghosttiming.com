import { ArrowLeft, CalendarClock, ExternalLink, Mail } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteActivityAction,
  updateActivityAction,
} from "@/app/activity-actions";
import {
  updateTaskStatusAction,
} from "@/app/actions";
import {
  permanentlyDeleteProspectAction,
  setProspectArchivedAction,
} from "@/app/lifecycle-actions";
import {
  restoreProspectCatalogMatchAction,
  updateProspectEventAction,
  updateProspectRoutingAction,
} from "@/app/prospect-actions";
import { removeTaskAction, saveTaskAction } from "@/app/task-actions";
import { ActivityAndTasksFeed } from "@/components/activity-and-tasks-feed";
import { CatalogMatchControls } from "@/components/catalog-match-controls";
import { ActivityTimelineItem } from "@/components/activity-timeline-item";
import { ExternalHref } from "@/components/crm-links";
import { EventLogo } from "@/components/event-logo";
import { EventTypeSelect } from "@/components/event-type-select";
import { LeadEmailCard } from "@/components/google/lead-email-card";
import { TaskCalendarSyncControl } from "@/components/google/task-calendar-sync-control";
import { ActivityComposer } from "@/components/outreach/activity-composer";
import { MeetingWrapUpButton } from "@/components/outreach/meeting-wrap-up-button";
import { ResyncGmailButton } from "@/components/google/resync-gmail-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ProspectEventOverview } from "@/components/prospecting/event-overview";
import { ProspectGlance } from "@/components/prospecting/glance";
import { LeadContactPanel } from "@/components/prospecting/lead-contact-panel";
import { LeadProfileLayout } from "@/components/prospecting/lead-profile-layout";
import { ProspectStagePath } from "@/components/prospecting/stage-path";
import { getPool } from "@/db";
import { requireProspectingAccess } from "@/lib/auth/server";
import { buildActivityTaskFeed } from "@/lib/crm/activity-feed";
import {
  activityEventType,
  closedLostReasonLabels,
  formatCalendarDate,
  formatTaskHeadline,
  isClosedLostReason,
  latestNonStageActivity,
  taskDescription,
  timelineLabel,
} from "@/lib/crm/domain";
import { parseMeetingMetadata, isMeetingActivity } from "@/lib/crm/outreach-activity";
import {
  asCatalogQuery,
  loadCatalogListingCandidates,
  resolveCatalogListingQuery,
  suggestCatalogMatches,
} from "@/lib/crm/catalog-link";
import { eventMatchKey } from "@/lib/crm/event-matching";
import { getProspectDetail, filePastProspectsWithPool } from "@/lib/crm/queries";
import {
  groupMessagesIntoThreads,
  listProspectEmailDrafts,
  listProspectEmailMessages,
} from "@/lib/crm/email-compose";
import { asSignatureSummaries, listUserEmailSignatures } from "@/lib/crm/email-signatures";
import { parseRouteUuid } from "@/lib/crm/route-id";
import { firstParam } from "@/lib/crm/search-params";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      timeZone: "America/New_York",
      }).format(date);
}

export default async function ProspectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ prospectId: string }>;
  searchParams: Promise<{
    edit?: string;
    listingQ?: string;
    replyThread?: string;
    draftId?: string;
  }>;
}) {
  const access = await requireProspectingAccess();
  const user = access.user;
  const prospectId = parseRouteUuid((await params).prospectId);
  const { edit, listingQ, replyThread, draftId } = await searchParams;
  await filePastProspectsWithPool();
  const data = await getProspectDetail(prospectId);
  if (!data.prospect) notFound();
  const { prospect } = data;
  const organizations =
    access.canAccessOperations && !prospect.converted_booking_id
      ? await getPool().query<{ id: string; name: string; is_direct_client: boolean }>(
          `
            SELECT org.id::text, org.name,
              bool_or(role.role = 'direct_client') AS is_direct_client
            FROM crm.organizations org
            LEFT JOIN crm.organization_roles role ON role.organization_id = org.id
            WHERE org.is_active = true
              AND ($1::uuid[] IS NULL OR org.id = ANY($1::uuid[]))
            GROUP BY org.id
            ORDER BY org.name
          `,
          [access.isSuperAdmin ? null : access.assignedOrgIds],
        )
      : { rows: [] };
  const directClients = organizations.rows.filter(
    (organization) => organization.is_direct_client,
  );
  const [users, people, emailDrafts, emailMessages, googleConnection, emailSignatures] = await Promise.all([
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.users WHERE is_active ORDER BY name`,
    ),
    getPool().query<{ id: string; display_name: string; email: string | null }>(
      `SELECT id::text, display_name, email FROM crm.people
       WHERE is_active AND archived_at IS NULL ORDER BY display_name`,
    ),
    listProspectEmailDrafts(getPool(), prospect.id),
    listProspectEmailMessages(getPool(), prospect.id),
    getPool().query<{ google_email: string }>(
      `SELECT google_email FROM crm.google_connections
       WHERE user_id = $1::uuid
       ORDER BY updated_at DESC
       LIMIT 1`,
      [user.id],
    ),
    listUserEmailSignatures(user.id),
  ]);
  const emailThreads = groupMessagesIntoThreads(
    emailMessages,
    googleConnection.rows[0]?.google_email,
  );
  const listingQuery = firstParam(listingQ)?.trim() || "";
  const needsCatalogMatch = !prospect.catalog_slug && !prospect.catalog_match_dismissed_at;
  let catalogSuggestions: ReturnType<typeof suggestCatalogMatches> = [];
  let catalogSearchResults: ReturnType<typeof suggestCatalogMatches> = [];
  if (needsCatalogMatch) {
    const catalogContext = await loadCatalogListingCandidates(
      asCatalogQuery((sql, params) => getPool().query(sql, params)),
      { names: [prospect.race_name], search: listingQuery },
    );
    catalogSuggestions = suggestCatalogMatches(
      {
        name: prospect.race_name,
        city: prospect.city,
        state: prospect.state,
      },
      catalogContext.listings,
      { takenIds: catalogContext.takenIds },
    );
    if (listingQuery) {
      const resolved = resolveCatalogListingQuery(
        listingQuery,
        catalogContext.listings,
        catalogContext.takenIds,
      );
      const rows =
        "match" in resolved && resolved.match
          ? [resolved.match]
          : "matches" in resolved
            ? resolved.matches
            : [];
      const eventKey = eventMatchKey(prospect.race_name);
      catalogSearchResults = rows.map((listing) => ({
        ...listing,
        score: eventMatchKey(listing.name) === eventKey ? 100 : 50,
        reason:
          eventMatchKey(listing.name) === eventKey
            ? ("exact" as const)
            : ("similar" as const),
      }));
    }
  }

  const lastActivity = latestNonStageActivity(data.activities);
  const prospectEmails = [
    ...new Set(
      data.contactMethods
        .filter((contact) => contact.type === "email")
        .map((contact) => contact.raw_value.trim())
        .filter(Boolean),
    ),
  ];
  const feed = buildActivityTaskFeed(data.activities, data.tasks);
  const activityById = new Map(data.activities.map((activity) => [activity.id, activity]));
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const feedActivityCount = feed.filter((item) => item.kind === "activity").length;

  return (
    <LeadProfileLayout
      header={
        <div className="space-y-3">
      <Link
        href="/prospecting"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to prospects
      </Link>

      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <EventLogo
              url={prospect.logo_url}
              name={prospect.race_name}
              size="header"
            />
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-900">
                  {prospect.stage_name}
                </span>
                {prospect.do_not_contact ? (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
                    Do Not Contact
                  </span>
                ) : null}
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{prospect.race_name}</h1>
              <p className="mt-2 text-slate-600">
                {formatDateTime(prospect.event_date)} · {prospect.location || "Location unknown"}
              </p>
              {prospect.registration_url ? (
                <ExternalHref
                  href={prospect.registration_url}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 hover:text-cyan-900"
                >
                  Registration page
                  <ExternalLink aria-hidden className="size-4" />
                </ExternalHref>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href="#lead-email"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800"
            >
              <Mail aria-hidden className="size-4" />
              Email
            </a>
            <ResyncGmailButton emails={prospectEmails} prospectId={prospect.id} />
            <Link href={`/prospecting/${prospect.id}?edit=event`}
              className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Edit event</Link>
            <Link href={`/prospecting/${prospect.id}?edit=routing`}
              className="inline-flex h-9 items-center rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Edit lead</Link>
          </div>
        </div>
        {edit === "event" ? (
          <div className="mt-5 border-t border-cyan-200 pt-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit private event details</h2>
              <Link href={`/prospecting/${prospect.id}`} className="text-sm font-semibold">Cancel</Link>
            </div>
            <p className="mt-1 text-sm text-slate-500">Online catalog source data will not be changed.</p>
            <form action={updateProspectEventAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="prospectId" value={prospect.id} />
              <input type="hidden" name="eventId" value={prospect.event_id} />
              <input type="hidden" name="occurrenceId" value={prospect.occurrence_id} />
              <label className="text-sm sm:col-span-2">Event name<input required name="eventName" defaultValue={prospect.race_name} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">Date and time<input type="datetime-local" name="raceDate" defaultValue={prospect.event_date_local ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">Timezone<input required name="timezone" defaultValue={prospect.timezone ?? "America/New_York"} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm sm:col-span-2">Registration URL<input type="url" name="registrationUrl" defaultValue={prospect.registration_url_override ?? ""} placeholder={prospect.registration_url ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm sm:col-span-2">Street<input name="street" defaultValue={prospect.street_override ?? ""} placeholder={prospect.street ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">Street 2<input name="street2" defaultValue={prospect.street2_override ?? ""} placeholder={prospect.street2 ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">City<input name="city" defaultValue={prospect.city_override ?? ""} placeholder={prospect.city ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">State<input name="state" defaultValue={prospect.state_override ?? ""} placeholder={prospect.state ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">ZIP code<input name="zipcode" defaultValue={prospect.zipcode_override ?? ""} placeholder={prospect.zipcode ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Save event details</PendingSubmitButton>
            </form>
          </div>
        ) : null}
        {edit === "routing" ? (
          <div className="mt-5 border-t border-cyan-200 pt-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit lead</h2>
              <Link href={`/prospecting/${prospect.id}`} className="text-sm font-semibold">Cancel</Link>
            </div>
            <form action={updateProspectRoutingAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="prospectId" value={prospect.id} />
              <input type="hidden" name="stageKey" value={prospect.stage_key} />
              <label className="text-sm">Owner<select name="assignedUserId" defaultValue={prospect.assigned_user_id ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Unassigned</option>{users.rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="text-sm">Primary contact<select name="primaryContactPersonId" defaultValue={prospect.primary_contact_person_id ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">None</option>{people.rows.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="doNotContact" defaultChecked={prospect.do_not_contact} /> Do not contact</label>
              <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Save lead</PendingSubmitButton>
            </form>
          </div>
        ) : null}
        <ProspectStagePath
          prospectId={prospect.id}
          currentStageKey={prospect.stage_key}
          stages={data.stages}
          variant="embedded"
          convertToBooking={
            access.canAccessOperations && !prospect.converted_booking_id
              ? {
                  directClients,
                  organizations: organizations.rows,
                  canViewFinancials: access.canViewAnyFinancials,
                }
              : null
          }
        />
      </header>
        </div>
      }
      contacts={
        <LeadContactPanel prospectId={prospect.id} contacts={data.contactMethods} />
      }
      glance={
        <>
      <ProspectGlance
        key={`${prospect.last_step_note ?? ""}-${prospect.next_step_on ?? ""}-${prospect.next_step_note ?? ""}`}
        prospectId={prospect.id}
        ownerName={prospect.owner_name}
        touchCount={prospect.touch_count}
        lastStepLabel={lastActivity ? timelineLabel(lastActivity) : null}
        lastStepAt={lastActivity?.occurred_at ?? prospect.last_step_at}
        lastStepNote={prospect.last_step_note}
        nextStepOn={prospect.next_step_on}
        nextStepNote={prospect.next_step_note}
      />

      {prospect.stage_key === "closed_lost" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Close lost
          </h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Reason</dt>
              <dd>
                {prospect.closed_lost_reason && isClosedLostReason(prospect.closed_lost_reason)
                  ? closedLostReasonLabels[prospect.closed_lost_reason]
                  : prospect.closed_lost_reason ?? "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Circle back</dt>
              <dd>{formatCalendarDate(prospect.circle_back_on) ?? "None"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Notes</dt>
              <dd className="whitespace-pre-wrap">
                {prospect.closed_lost_note || "None"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

          {prospect.converted_booking_id ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="font-bold text-emerald-950">Converted to Booking</h2>
              {access.canAccessOperations ? (
                <Link
                  href={`/bookings/${prospect.converted_booking_id}`}
                  className="mt-2 inline-block text-sm font-semibold text-emerald-800 underline"
                >
                  Open booking
                </Link>
              ) : (
                <p className="mt-2 text-sm text-emerald-900">
                  The operations team now owns the booking.
                </p>
              )}
            </section>
          ) : null}
        </>
      }
      email={
        <LeadEmailCard
          prospectId={prospect.id}
          raceName={prospect.race_name}
          doNotContact={prospect.do_not_contact}
          contactEmails={data.contactMethods
            .filter((contact) => contact.type === "email")
            .map((contact) => ({
              value: contact.raw_value,
              isPrimary: contact.is_primary,
              status: contact.status,
            }))}
          drafts={emailDrafts}
          threads={emailThreads}
          initialReplyThreadId={firstParam(replyThread)?.trim() || null}
          initialDraftId={firstParam(draftId)?.trim() || null}
          signatures={asSignatureSummaries(emailSignatures)}
          variant="workspace"
          collapsible
        />
      }
      race={
        <>
      {prospect.catalog_slug ? (
        <ProspectEventOverview
          prospect={prospect}
          tags={data.catalogTags}
          offerings={data.catalogOfferings}
          collapsible
        />
      ) : prospect.catalog_match_dismissed_at ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Event overview
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Marked as not in the online catalog.
          </p>
          <form action={restoreProspectCatalogMatchAction} className="mt-2">
            <input type="hidden" name="prospectId" value={prospect.id} />
            <PendingSubmitButton className="text-sm font-semibold text-cyan-700 hover:text-cyan-900 disabled:opacity-60">
              Return to listing review
            </PendingSubmitButton>
          </form>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Match online listing
          </h2>
          <p className="mt-1 mb-3 text-sm text-slate-600">
            Search the online catalog or RunSignUp, or paste a registration
            link, then match so event details, distances, and tags fill in.
          </p>
          <CatalogMatchControls
            prospectId={prospect.id}
            suggestions={catalogSuggestions}
            searchResults={catalogSearchResults}
            searchQuery={listingQuery}
          />
        </section>
      )}
          {prospect.legacy_note ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h2 className="font-bold text-amber-950">Legacy lead note</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">
                {prospect.legacy_note}
              </p>
              {prospect.legacy_status ? (
                <p className="mt-2 text-xs text-amber-700">{prospect.legacy_status}</p>
              ) : null}
            </section>
          ) : null}
        </>
      }
      log={
        <ActivityComposer
          recordKind="prospect"
          recordId={prospect.id}
          recordTitle={prospect.race_name}
          contacts={data.contactMethods
            .filter((contact) => contact.type === "email")
            .map((contact, index) => ({
              email: contact.raw_value,
              label: contact.label || (contact.is_primary ? "Primary" : "Lead email"),
              defaultSelected: contact.is_primary || index === 0,
            }))}
          people={people.rows.map((person) => ({
            id: person.id,
            name: person.display_name,
            email: person.email,
          }))}
        />
      }
      timeline={
          <ActivityAndTasksFeed
            taskCount={data.tasks.length}
            activityCount={feedActivityCount}
            addTask={
              <details className="rounded-lg border border-dashed p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-cyan-700">+ Add task</summary>
                <form action={saveTaskAction} className="mt-3 space-y-2">
                  <input type="hidden" name="prospectId" value={prospect.id} />
                  <label className="block">Event type<EventTypeSelect className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                  <label className="block">Due<input required type="datetime-local" name="dueAt" className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                  <label className="block">Assignee<select name="assignedUserId" className="mt-1 w-full rounded-lg border px-2 py-1">{users.rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <input type="hidden" name="status" value="open" />
                  <label className="block">Description<textarea name="description" className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                  <PendingSubmitButton className="font-semibold text-cyan-700 disabled:opacity-60">Create task</PendingSubmitButton>
                </form>
              </details>
            }
          >
            {feed.map((item) => {
              if (item.kind === "task") {
                const task = taskById.get(item.id);
                if (!task) return null;
                return (
                  <div key={`task-${task.id}`} data-feed-kind="task">
                    <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                      <summary className="cursor-pointer">
                        <span className="inline-flex flex-wrap items-center gap-2 font-semibold">
                          <CalendarClock aria-hidden className="size-4 text-cyan-700" />
                          Task · {formatTaskHeadline(task.title, task.notes)}
                          <TaskCalendarSyncControl
                            taskId={task.id}
                            syncStatus={task.calendar_sync_status ?? null}
                          />
                        </span>
                        <span className="ml-2 text-slate-500">{formatDateTime(task.due_at)} · {task.status}</span>
                      </summary>
                      <form
                        key={`${task.id}-${task.title}-${task.notes ?? ""}-${task.status}`}
                        action={saveTaskAction}
                        className="mt-3 space-y-2"
                      >
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="prospectId" value={prospect.id} />
                        <label className="block">Event type<EventTypeSelect defaultValue={task.title} className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                        <label className="block">Due<input required type="datetime-local" name="dueAt" defaultValue={task.due_local ?? ""} className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                        <label className="block">Assignee<select name="assignedUserId" defaultValue={task.assigned_user_id} className="mt-1 w-full rounded-lg border px-2 py-1">{users.rows.map((userRow) => <option key={userRow.id} value={userRow.id}>{userRow.name}</option>)}</select></label>
                        <label className="block">Status<select name="status" defaultValue={task.status} className="mt-1 w-full rounded-lg border px-2 py-1"><option value="open">Open</option><option value="complete">Complete</option><option value="canceled">Canceled</option></select></label>
                        <label className="block">Description<textarea name="description" defaultValue={taskDescription(task.title, task.notes)} className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                        <PendingSubmitButton className="font-semibold text-cyan-700 disabled:opacity-60">Save task</PendingSubmitButton>
                      </form>
                      {task.status === "open" ? (
                        <form action={updateTaskStatusAction} className="mt-2">
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="status" value="complete" />
                          <button className="font-semibold text-cyan-700">Mark complete</button>
                        </form>
                      ) : null}
                      <form action={removeTaskAction} className="mt-2"><input type="hidden" name="taskId" value={task.id} /><button className="font-semibold text-red-700">Remove task</button></form>
                    </details>
                  </div>
                );
              }
              const activity = activityById.get(item.id);
              if (!activity) return null;
              return (
                <div key={`activity-${activity.id}`} data-feed-kind="activity">
                  <ActivityTimelineItem
                    activity={activity}
                    replyHref={
                      activity.metadata?.gmailThreadId
                        ? `/prospecting/${prospect.id}?replyThread=${encodeURIComponent(activity.metadata.gmailThreadId)}#lead-email`
                        : undefined
                    }
                    actions={
                      isMeetingActivity(activity) &&
                      !parseMeetingMetadata(activity.metadata)?.wrapUp ? (
                        <MeetingWrapUpButton
                          activityId={activity.id}
                          recordKind="prospect"
                        />
                      ) : null
                    }
                  />
                  {user.role === "admin" && activity.metadata?.source !== "gmail" ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-cyan-700">
                        Edit timeline event
                      </summary>
                      <form
                        key={`${activity.id}-${activity.type}-${activity.body}-${activity.occurred_local}`}
                        action={updateActivityAction}
                        className="mt-2 space-y-2"
                      >
                        <input type="hidden" name="activityId" value={activity.id} />
                        {activity.type === "stage_change" ? null : (
                          <label className="block text-xs font-medium">
                            Event type
                            <EventTypeSelect
                              defaultValue={activityEventType(activity)}
                              className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                            />
                          </label>
                        )}
                        <label className="block text-xs font-medium">
                          Description
                          <textarea
                            name="body"
                            required
                            defaultValue={activity.body}
                            rows={3}
                            className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium">
                          When
                          <input
                            type="datetime-local"
                            name="occurredAt"
                            required
                            defaultValue={activity.occurred_local}
                            className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                          />
                        </label>
                        <PendingSubmitButton className="font-semibold text-cyan-700 disabled:opacity-60">
                          Save event
                        </PendingSubmitButton>
                      </form>
                      <form action={deleteActivityAction} className="mt-2">
                        <input type="hidden" name="activityId" value={activity.id} />
                        <button className="text-xs font-semibold text-red-700">
                          Remove from timeline
                        </button>
                      </form>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </ActivityAndTasksFeed>
      }
      footer={
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-bold text-red-950">Danger zone</h2>
        {prospect.archived_at ? (
          <div className="mt-3 space-y-4">
            <form action={setProspectArchivedAction}>
              <input type="hidden" name="prospectId" value={prospect.id} />
              <input type="hidden" name="operation" value="restore" />
              <button className="rounded-lg border bg-white px-4 py-2 font-semibold">Restore prospect</button>
            </form>
            {user.role === "admin" ? (
              <form action={permanentlyDeleteProspectAction} className="space-y-2">
                <label className="block text-sm">Type DELETE to permanently remove this CRM prospect.
                  <input required name="confirmation" className="mt-1 block rounded-lg border border-red-300 px-3 py-2" />
                </label>
                <input type="hidden" name="prospectId" value={prospect.id} />
                <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">Permanently delete</button>
              </form>
            ) : null}
          </div>
        ) : (
          <form action={setProspectArchivedAction} className="mt-3">
            <input type="hidden" name="prospectId" value={prospect.id} />
            <input type="hidden" name="operation" value="archive" />
            <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">Archive prospect</button>
          </form>
        )}
      </section>
      }
    />
  );
}
