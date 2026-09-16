import { ArrowLeft, CalendarClock, ExternalLink, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteActivityAction,
  updateActivityAction,
} from "@/app/activity-actions";
import {
  logActivityAction,
  updateTaskStatusAction,
} from "@/app/actions";
import { convertProspectToBookingAction } from "@/app/booking-actions";
import {
  permanentlyDeleteProspectAction,
  setProspectArchivedAction,
} from "@/app/lifecycle-actions";
import {
  restoreProspectCatalogMatchAction,
  removeProspectContactMethodAction,
  saveProspectContactMethodAction,
  updateProspectEventAction,
  updateProspectRoutingAction,
} from "@/app/prospect-actions";
import { removeTaskAction, saveTaskAction } from "@/app/task-actions";
import { ActivityAndTasksFeed } from "@/components/activity-and-tasks-feed";
import { CatalogMatchControls } from "@/components/catalog-match-controls";
import { ActivityTimelineItem } from "@/components/activity-timeline-item";
import { EventLogo } from "@/components/event-logo";
import { EventTypeSelect } from "@/components/event-type-select";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ProspectEventOverview } from "@/components/prospecting/event-overview";
import { ProspectGlance } from "@/components/prospecting/glance";
import { ProspectStagePath } from "@/components/prospecting/stage-path";
import { getPool } from "@/db";
import { requireProspectingAccess } from "@/lib/auth/server";
import { buildActivityTaskFeed } from "@/lib/crm/activity-feed";
import {
  activityEventType,
  closedLostReasonLabels,
  dispositions,
  formatCalendarDate,
  formatTaskHeadline,
  isClosedLostReason,
  latestNonStageActivity,
  taskDescription,
  timelineLabel,
} from "@/lib/crm/domain";
import {
  asCatalogQuery,
  loadCatalogListingCandidates,
  resolveCatalogListingQuery,
  suggestCatalogMatches,
} from "@/lib/crm/catalog-link";
import { eventMatchKey } from "@/lib/crm/event-matching";
import { getProspectDetail, reconcileProspectingWithPool } from "@/lib/crm/queries";
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
  searchParams: Promise<{ edit?: string; listingQ?: string }>;
}) {
  const access = await requireProspectingAccess();
  const user = access.user;
  const { prospectId } = await params;
  const { edit, listingQ } = await searchParams;
  await reconcileProspectingWithPool(user);
  const data = await getProspectDetail(prospectId);
  if (!data.prospect) notFound();
  const { prospect } = data;
  const organizations =
    access.canAccessOperations &&
    prospect.stage_key === "confirmed" &&
    !prospect.converted_booking_id
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
  const [users, people] = await Promise.all([
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.users WHERE is_active ORDER BY name`,
    ),
    getPool().query<{ id: string; display_name: string }>(
      `SELECT id::text, display_name FROM crm.people
       WHERE is_active AND archived_at IS NULL ORDER BY display_name`,
    ),
  ]);
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
  const feed = buildActivityTaskFeed(data.activities, data.tasks);
  const activityById = new Map(data.activities.map((activity) => [activity.id, activity]));
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const feedActivityCount = feed.filter((item) => item.kind === "activity").length;

  return (
    <div className="space-y-6">
      <Link
        href="/prospecting"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to prospects
      </Link>

      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
              <h1 className="text-3xl font-bold tracking-tight">{prospect.race_name}</h1>
              <p className="mt-2 text-slate-600">
                {formatDateTime(prospect.event_date)} · {prospect.location || "Location unknown"}
              </p>
              {prospect.registration_url ? (
                <a
                  href={prospect.registration_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 hover:text-cyan-900"
                >
                  Registration page
                  <ExternalLink aria-hidden className="size-4" />
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
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
            <p className="mt-1 text-sm text-slate-500">Catalog source data will not be changed.</p>
            <form action={updateProspectEventAction} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="prospectId" value={prospect.id} />
              <input type="hidden" name="eventId" value={prospect.event_id} />
              <input type="hidden" name="occurrenceId" value={prospect.occurrence_id} />
              <label className="text-sm sm:col-span-2">Event name<input required name="eventName" defaultValue={prospect.race_name} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">Date and time<input type="datetime-local" name="raceDate" defaultValue={prospect.event_date_local ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">Timezone<input required name="timezone" defaultValue={prospect.timezone ?? "America/New_York"} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm sm:col-span-2">Registration URL<input type="url" name="registrationUrl" defaultValue={prospect.registration_url ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm sm:col-span-2">Street<input name="street" defaultValue={prospect.street ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">Street 2<input name="street2" defaultValue={prospect.street2 ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">City<input name="city" defaultValue={prospect.city ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">State<input name="state" defaultValue={prospect.state ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm">ZIP code<input name="zipcode" defaultValue={prospect.zipcode ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
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
      </header>

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

      <ProspectStagePath
        prospectId={prospect.id}
        currentStageKey={prospect.stage_key}
        stages={data.stages}
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

      {prospect.catalog_slug ? (
        <ProspectEventOverview
          prospect={prospect}
          tags={data.catalogTags}
          offerings={data.catalogOfferings}
        />
      ) : prospect.catalog_match_dismissed_at ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Event overview
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Marked as not in the catalog.
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
            Match catalog listing
          </h2>
          <p className="mt-1 mb-3 text-sm text-slate-600">
            Search Get Run Vibes or Race Roster by name, location, or year, then
            match so event details, distances, and tags fill in from the catalog.
          </p>
          <CatalogMatchControls
            prospectId={prospect.id}
            suggestions={catalogSuggestions}
            searchResults={catalogSearchResults}
            searchQuery={listingQuery}
          />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Log what happened</h2>
            <form action={logActivityAction} className="mt-4 grid gap-4">
              <input type="hidden" name="prospectId" value={prospect.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Event type
                  <EventTypeSelect className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Disposition
                  <select
                    name="disposition"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="">None</option>
                    {dispositions.map((disposition) => (
                      <option key={disposition}>{disposition}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                Description
                <textarea
                  name="body"
                  required
                  rows={4}
                  placeholder="What happened?"
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <fieldset className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold">Optional follow-up task</legend>
                <label className="grid gap-1 text-sm font-medium">
                  Next action
                  <input
                    name="followUpTitle"
                    placeholder="Email Sarah"
                    className="rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Due
                  <input
                    name="followUpDueAt"
                    type="datetime-local"
                    className="rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </fieldset>
              <PendingSubmitButton className="justify-self-start rounded-lg bg-cyan-600 px-5 py-2.5 font-semibold text-white hover:bg-cyan-700 disabled:opacity-60">
                Save activity
              </PendingSubmitButton>
            </form>
          </section>

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
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <CalendarClock aria-hidden className="size-4 text-cyan-700" />
                          Task · {formatTaskHeadline(task.title, task.notes)}
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
                  <ActivityTimelineItem activity={activity} />
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
        </div>

        <aside className="space-y-6">
          {prospect.converted_booking_id ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
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
          ) : access.canAccessOperations && prospect.stage_key === "confirmed" ? (
            <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
              <h2 className="font-bold text-cyan-950">Convert to Booking</h2>
              {directClients.length ? (
                <form action={convertProspectToBookingAction} className="mt-4 space-y-3">
                  <input type="hidden" name="prospectId" value={prospect.id} />
                  <label className="block text-sm font-medium">
                    Direct client
                    <select name="directClientId" required className="mt-1 w-full rounded-lg border border-cyan-200 bg-white px-3 py-2">
                      <option value="">Select client</option>
                      {directClients.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium">
                    Event owner (optional)
                    <select name="eventOwnerId" className="mt-1 w-full rounded-lg border border-cyan-200 bg-white px-3 py-2">
                      <option value="">Same as direct client</option>
                      {organizations.rows.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </select>
                  </label>
                  {access.canViewAnyFinancials ? (
                    <label className="block text-sm font-medium">
                      Expected revenue
                      <input name="expectedRevenue" inputMode="decimal" placeholder="0.00" className="mt-1 w-full rounded-lg border border-cyan-200 bg-white px-3 py-2" />
                    </label>
                  ) : null}
                  <button className="w-full rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white">
                    Create Booking
                  </button>
                </form>
              ) : (
                <p className="mt-2 text-sm text-cyan-900">
                  Add a Direct Client organization before converting.
                </p>
              )}
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold">Contact methods</h2>
            <div className="mt-3 space-y-2 text-sm">
              {data.contactMethods.map((contact) => (
                <details key={`${contact.id}-${contact.type}`} className="rounded-lg bg-slate-50 p-2">
                  <summary className="flex cursor-pointer items-center gap-2">
                    {contact.type === "email" ? <Mail aria-hidden className="size-4 text-slate-400" /> : <Phone aria-hidden className="size-4 text-slate-400" />}
                    <span>{contact.raw_value}</span>
                    {contact.label ? <span className="text-xs text-slate-500">({contact.label})</span> : null}
                  </summary>
                  {contact.editable ? (
                    <>
                      <form action={saveProspectContactMethodAction} className="mt-2 space-y-2">
                        <input type="hidden" name="prospectId" value={prospect.id} />
                        <input type="hidden" name="contactMethodId" value={contact.id} />
                        <label className="block">Type<select name="type" defaultValue={contact.type} className="mt-1 w-full rounded-lg border px-2 py-1"><option value="email">Email</option><option value="phone">Phone</option></select></label>
                        <label className="block">Value<input required name="value" defaultValue={contact.raw_value} className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                        <label className="block">Label<input name="label" defaultValue={contact.label ?? ""} className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                        <label className="block">Status<select name="status" defaultValue={contact.status} className="mt-1 w-full rounded-lg border px-2 py-1"><option value="unknown">Unknown</option><option value="valid">Valid</option><option value="invalid">Invalid</option><option value="opted_out">Opted out</option></select></label>
                        <label className="flex gap-2"><input type="checkbox" name="isPrimary" defaultChecked={contact.is_primary} /> Primary</label>
                        <button className="font-semibold text-cyan-700">Save contact method</button>
                      </form>
                      <form action={removeProspectContactMethodAction} className="mt-2">
                        <input type="hidden" name="prospectId" value={prospect.id} />
                        <input type="hidden" name="contactMethodId" value={contact.id} />
                        <button className="font-semibold text-red-700">Remove</button>
                      </form>
                    </>
                  ) : <p className="mt-2 text-xs text-slate-500">Edit this person from their organization record.</p>}
                </details>
              ))}
              {data.contactMethods.length === 0 ? (
                <p className="text-slate-500">
                  Contact detected in the description; structured extraction comes next.
                </p>
              ) : null}
            </div>
            <details className="mt-4 rounded-lg border border-dashed p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-cyan-700">+ Add contact method</summary>
              <form action={saveProspectContactMethodAction} className="mt-3 space-y-2">
                <input type="hidden" name="prospectId" value={prospect.id} />
                <label className="block">Type<select name="type" className="mt-1 w-full rounded-lg border px-2 py-1"><option value="email">Email</option><option value="phone">Phone</option></select></label>
                <label className="block">Value<input required name="value" className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                <label className="block">Label<input name="label" className="mt-1 w-full rounded-lg border px-2 py-1" /></label>
                <input type="hidden" name="status" value="unknown" />
                <label className="flex gap-2"><input type="checkbox" name="isPrimary" /> Primary</label>
                <button className="font-semibold text-cyan-700">Add</button>
              </form>
            </details>
          </section>

          {prospect.legacy_note ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="font-bold text-amber-950">Legacy lead note</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">
                {prospect.legacy_note}
              </p>
              {prospect.legacy_status ? (
                <p className="mt-2 text-xs text-amber-700">{prospect.legacy_status}</p>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
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
    </div>
  );
}
