import {
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  CircleDollarSign,
  ClockAlert,
  Search,
  Target,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getPool } from "@/db";
import { bookingOrgScopeParam, financialOrgScopeParam } from "@/lib/auth/access";
import { getAccessContext } from "@/lib/auth/server";
import {
  resolveDashboardPeriod,
  type DashboardPeriod,
} from "@/lib/crm/dashboard-period";
import { formatTaskHeadline } from "@/lib/crm/domain";

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-sm font-medium">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-950 sm:text-3xl">{value}</p>
    </div>
  );
}

function formatMoney(value: string | number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function PeriodControls({ period }: { period: DashboardPeriod }) {
  return (
    <form
      method="get"
      className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[minmax(10rem,1fr)_1fr_1fr_auto] sm:items-end"
    >
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Dashboard period
        <select
          name="period"
          defaultValue={period.key}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2"
        >
          <option value="year">Current year</option>
          <option value="all">All time</option>
          <option value="custom">Custom range</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        From
        <input
          type="date"
          name="from"
          defaultValue={period.customStartDefault}
          className="rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Through
        <input
          type="date"
          name="to"
          defaultValue={period.customEndDefault}
          className="rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <button className="rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white hover:bg-slate-800">
        Apply
      </button>
      <p className="text-sm text-slate-500 sm:col-span-4">
        Showing {period.label}. Dates are used when Custom range is selected.
      </p>
    </form>
  );
}

type MonthlyBooking = {
  month: string;
  label: string;
  race_count: number;
  expected_income: string;
};

function MonthlyBookingChart({ months }: { months: MonthlyBooking[] }) {
  const maximum = Math.max(
    1,
    ...months.map((month) => Number(month.expected_income)),
  );
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="flex items-center gap-2 font-bold">
          <ChartNoAxesColumnIncreasing className="size-5 text-cyan-700" />
          Races and expected income by month
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Expected income uses each booked event&apos;s Expected value.
        </p>
      </div>
      {months.length ? (
        <div className="overflow-x-auto p-5">
          <div className="flex min-w-max items-end gap-3">
            {months.map((month) => {
              const income = Number(month.expected_income);
              const height = Math.max(8, Math.round((income / maximum) * 128));
              return (
                <div
                  key={month.month}
                  className="flex w-24 flex-col items-center"
                  aria-label={`${month.label}: ${month.race_count} races, ${formatMoney(income)} expected`}
                >
                  <p className="text-xs font-bold text-slate-700">
                    {formatMoney(income)}
                  </p>
                  <p className="mb-2 text-xs text-slate-500">
                    {month.race_count} {month.race_count === 1 ? "race" : "races"}
                  </p>
                  <div className="flex h-32 items-end">
                    <div
                      className="w-12 rounded-t-md bg-gradient-to-t from-cyan-700 to-cyan-400"
                      style={{ height }}
                    />
                  </div>
                  <p className="mt-2 text-center text-xs font-medium text-slate-600">
                    {month.label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="p-6 text-sm text-slate-500">
          No booked events in this period.
        </p>
      )}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  const access = await getAccessContext();
  const user = access.user;
  const period = resolveDashboardPeriod(await searchParams);
  const periodParameters = [period.startDate, period.endExclusive];
  const prospectMetrics = await getPool().query<{
    active: number;
    untouched: number;
    contacted: number;
    contacting: number;
    scoping: number;
    meetings_set: number;
    converted: number;
    closed_lost: number;
    disqualified: number;
    unqualified: number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE queue.closed_at IS NULL)::integer AS active,
        COUNT(*) FILTER (
          WHERE queue.closed_at IS NULL AND queue.touch_count = 0
        )::integer AS untouched,
        COUNT(*) FILTER (
          WHERE queue.closed_at IS NULL AND queue.touch_count > 0
        )::integer AS contacted,
        COUNT(*) FILTER (WHERE queue.stage_key = 'cold')::integer AS contacting,
        COUNT(*) FILTER (WHERE queue.stage_key = 'scoping')::integer AS scoping,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM crm.activities activity
            WHERE activity.prospect_id = queue.prospect_id
              AND activity.disposition = 'Meeting Set'
          )
        )::integer AS meetings_set,
        COUNT(*) FILTER (WHERE queue.converted_booking_id IS NOT NULL)::integer
          AS converted,
        COUNT(*) FILTER (WHERE queue.stage_key = 'closed_lost')::integer
          AS closed_lost,
        COUNT(*) FILTER (WHERE queue.stage_key = 'disqualified')::integer
          AS disqualified,
        COUNT(*) FILTER (WHERE queue.stage_key = 'unqualified')::integer
          AS unqualified
      FROM crm.prospect_work_queue queue
      JOIN crm.prospects prospect ON prospect.id = queue.prospect_id
      LEFT JOIN crm.event_occurrences occurrence
        ON occurrence.id = prospect.occurrence_id
      LEFT JOIN catalog.race_listings listing
        ON listing.id = prospect.race_listing_id
      LEFT JOIN catalog.race_editions edition
        ON edition.id = prospect.race_edition_id
      WHERE prospect.archived_at IS NULL
      AND (
        $1::date IS NULL OR
        COALESCE(occurrence.race_date, edition.starts_at, listing.next_start_at) >=
          $1::date::timestamp AT TIME ZONE 'America/New_York'
      )
      AND (
        $2::date IS NULL OR
        COALESCE(occurrence.race_date, edition.starts_at, listing.next_start_at) <
          $2::date::timestamp AT TIME ZONE 'America/New_York'
      )
    `,
    periodParameters,
  );
  const prospect = prospectMetrics.rows[0];

  if (access.canAccessOperations) {
    const orgScope = bookingOrgScopeParam(access);
    const financialScope = financialOrgScopeParam(access);
    const operationsParams = [...periodParameters, orgScope];
    const financialParams = [...periodParameters, orgScope, financialScope];
    const [operations, upcoming, monthly] = await Promise.all([
      getPool().query<{
        upcoming: number;
        needs_prep: number;
        awaiting_decision: number;
        completed_unpaid: number;
        booked_revenue: string;
        paid_total: string;
        completed_total: string;
        closed_lost: number;
      }>(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE occurrence.race_date >= now()
                AND stage.key NOT IN ('paid', 'closed_lost')
            )::integer AS upcoming,
            COUNT(*) FILTER (
              WHERE occurrence.race_date BETWEEN now() AND now() + interval '14 days'
                AND stage.key NOT IN ('ready', 'completed', 'paid', 'closed_lost')
                AND EXISTS (
                  SELECT 1 FROM crm.booking_prep_items prep
                  WHERE prep.booking_id = booking.id AND prep.status = 'pending'
                )
            )::integer AS needs_prep,
            COUNT(*) FILTER (WHERE stage.key = 'awaiting_decision')::integer
              AS awaiting_decision,
            COUNT(*) FILTER (
              WHERE stage.key = 'completed' AND booking.payment_at IS NULL
            )::integer AS completed_unpaid,
            COALESCE(SUM(booking.expected_revenue) FILTER (
              WHERE stage.key IN ('confirmed', 'pre_event_prep', 'ready')
                AND ($4::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($4::uuid[]))
            ), 0)::text AS booked_revenue,
            COALESCE(SUM(booking.amount_paid) FILTER (
              WHERE booking.payment_at IS NOT NULL
                AND ($4::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($4::uuid[]))
            ), 0)::text AS paid_total,
            COALESCE(SUM(COALESCE(
              booking.actual_revenue, booking.expected_revenue
            )) FILTER (
              WHERE stage.key IN ('completed', 'paid')
                AND ($4::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($4::uuid[]))
            ), 0)::text AS completed_total,
            COUNT(*) FILTER (WHERE stage.key = 'closed_lost')::integer
              AS closed_lost
          FROM crm.bookings booking
          JOIN crm.event_occurrences occurrence
            ON occurrence.id = booking.occurrence_id
          JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
          WHERE booking.archived_at IS NULL
          AND (
            $1::date IS NULL OR occurrence.race_date >=
              $1::date::timestamp AT TIME ZONE 'America/New_York'
          )
          AND (
            $2::date IS NULL OR occurrence.race_date <
              $2::date::timestamp AT TIME ZONE 'America/New_York'
          )
          AND ($3::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($3::uuid[]))
        `,
        financialParams,
      ),
      getPool().query<{
        id: string;
        event_name: string;
        race_date: string | null;
        stage_name: string;
        client_name: string;
        pending_prep: number;
      }>(
        `
          SELECT booking.id::text, event.name AS event_name,
            occurrence.race_date::text, stage.name AS stage_name,
            client.name AS client_name,
            COUNT(prep.id) FILTER (WHERE prep.status = 'pending')::integer
              AS pending_prep
          FROM crm.bookings booking
          JOIN crm.event_occurrences occurrence
            ON occurrence.id = booking.occurrence_id
          JOIN crm.events event ON event.id = occurrence.event_id
          JOIN crm.organizations client
            ON client.id = booking.direct_client_organization_id
          JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
          LEFT JOIN crm.booking_prep_items prep ON prep.booking_id = booking.id
          WHERE booking.archived_at IS NULL
            AND occurrence.race_date >= now()
            AND stage.key NOT IN ('paid', 'closed_lost')
            AND (
              $1::date IS NULL OR occurrence.race_date >=
                $1::date::timestamp AT TIME ZONE 'America/New_York'
            )
            AND (
              $2::date IS NULL OR occurrence.race_date <
                $2::date::timestamp AT TIME ZONE 'America/New_York'
            )
            AND ($3::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($3::uuid[]))
          GROUP BY booking.id, event.id, occurrence.id, stage.id, client.id
          ORDER BY occurrence.race_date
          LIMIT 8
        `,
        operationsParams,
      ),
      getPool().query<MonthlyBooking>(
        `
          SELECT
            to_char(date_trunc('month', occurrence.race_date), 'YYYY-MM') AS month,
            to_char(date_trunc('month', occurrence.race_date), 'Mon YYYY') AS label,
            COUNT(*)::integer AS race_count,
            COALESCE(SUM(booking.expected_revenue), 0)::text AS expected_income
          FROM crm.bookings booking
          JOIN crm.event_occurrences occurrence
            ON occurrence.id = booking.occurrence_id
          JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
          WHERE booking.archived_at IS NULL
          AND stage.key IN (
            'confirmed', 'pre_event_prep', 'ready', 'completed', 'paid'
          )
          AND (
            $1::date IS NULL OR occurrence.race_date >=
              $1::date::timestamp AT TIME ZONE 'America/New_York'
          )
          AND (
            $2::date IS NULL OR occurrence.race_date <
              $2::date::timestamp AT TIME ZONE 'America/New_York'
          )
          AND ($3::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($3::uuid[]))
          AND ($4::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($4::uuid[]))
          GROUP BY date_trunc('month', occurrence.race_date)
          ORDER BY date_trunc('month', occurrence.race_date)
        `,
        financialParams,
      ),
    ]);
    const ops = operations.rows[0];

    return (
      <div className="space-y-8">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
            Welcome back, {user.name.split(" ")[0]}
          </p>
          <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-slate-600">
            What needs attention across operations and prospecting.
          </p>
        </header>
        <PeriodControls period={period} />

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Operations</h2>
            <p className="text-sm text-slate-500">Booked work and payment status</p>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label="Upcoming events" value={ops.upcoming} icon={<CalendarClock className="size-5" />} />
            <Metric label="Next 14 days needing prep" value={ops.needs_prep} icon={<ClockAlert className="size-5" />} />
            <Metric label="Awaiting decision" value={ops.awaiting_decision} icon={<Target className="size-5" />} />
            {access.canViewAnyFinancials ? (
              <>
            <Metric label="Completed, unpaid" value={ops.completed_unpaid} icon={<CircleDollarSign className="size-5" />} />
            <Metric label="Booked revenue" value={formatMoney(ops.booked_revenue)} icon={<CircleDollarSign className="size-5" />} />
            <Metric label="Completed revenue" value={formatMoney(ops.completed_total)} icon={<CheckCircle2 className="size-5" />} />
            <Metric label="Total paid" value={formatMoney(ops.paid_total)} icon={<CircleDollarSign className="size-5" />} />
              </>
            ) : null}
            <Metric label="Closed Lost" value={ops.closed_lost} icon={<Target className="size-5" />} />
          </div>
          {access.canViewAnyFinancials ? <MonthlyBookingChart months={monthly.rows} /> : null}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-bold">Upcoming booked events</h3>
              <Link href="/bookings" className="text-sm font-semibold text-cyan-700">View all</Link>
            </div>
            <div className="divide-y divide-slate-100">
              {upcoming.rows.map((booking) => (
                <Link key={booking.id} href={`/bookings/${booking.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                  <div><p className="font-semibold">{booking.event_name}</p><p className="text-sm text-slate-500">{booking.client_name}</p></div>
                  <div className="text-right text-sm"><p>{booking.stage_name}</p><p className={booking.pending_prep ? "text-amber-700" : "text-slate-500"}>{booking.pending_prep} prep items pending</p></div>
                </Link>
              ))}
              {!upcoming.rows.length ? <p className="p-6 text-sm text-slate-500">No upcoming bookings yet.</p> : null}
            </div>
          </div>
        </section>

        {access.canAccessProspecting ? (
        <section className="space-y-4 border-t border-slate-300 pt-8">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Prospecting</h2>
            <p className="text-sm text-slate-500">Current lead pipeline</p>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label="Active prospects" value={prospect.active} icon={<Search className="size-5" />} />
            <Metric label="Untouched" value={prospect.untouched} icon={<ClockAlert className="size-5" />} />
            <Metric label="Contacted" value={prospect.contacted} icon={<CheckCircle2 className="size-5" />} />
            <Metric label="Contacting" value={prospect.contacting} icon={<Target className="size-5" />} />
            <Metric label="Scoping" value={prospect.scoping} icon={<Target className="size-5" />} />
            <Metric label="Meetings set" value={prospect.meetings_set} icon={<CalendarClock className="size-5" />} />
            <Metric label="Converted" value={prospect.converted} icon={<CheckCircle2 className="size-5" />} />
            <Metric label="Closed Lost" value={prospect.closed_lost} icon={<Target className="size-5" />} />
            <Metric label="Disqualified" value={prospect.disqualified} icon={<Target className="size-5" />} />
            <Metric label="Unqualified" value={prospect.unqualified} icon={<Target className="size-5" />} />
          </div>
        </section>
        ) : null}
      </div>
    );
  }

  const [taskMetrics, tasks, pipeline] = await Promise.all([
    getPool().query<{
      overdue: number;
      due_today: number;
      upcoming: number;
    }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE due_at < CURRENT_DATE)::integer AS overdue,
          COUNT(*) FILTER (
            WHERE due_at >= CURRENT_DATE AND due_at < CURRENT_DATE + interval '1 day'
          )::integer AS due_today,
          COUNT(*) FILTER (WHERE due_at >= CURRENT_DATE + interval '1 day')::integer
            AS upcoming
        FROM crm.tasks
        WHERE assigned_user_id = $1::uuid AND status = 'open'
      `,
      [user.id],
    ),
    getPool().query<{
      id: string;
      title: string;
      notes: string | null;
      due_at: string;
      prospect_id: string;
      race_name: string;
    }>(
      `
        SELECT task.id::text, task.title, task.notes, task.due_at::text,
          task.prospect_id::text, COALESCE(event.name, listing.name) AS race_name
        FROM crm.tasks task
        JOIN crm.prospects prospect ON prospect.id = task.prospect_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = prospect.race_listing_id
        LEFT JOIN crm.events event ON event.id = prospect.event_id
        WHERE task.assigned_user_id = $1::uuid AND task.status = 'open'
          AND prospect.archived_at IS NULL
        ORDER BY task.due_at
        LIMIT 10
      `,
      [user.id],
    ),
    getPool().query<{ stage_name: string; count: number }>(
      `
        SELECT stage.name AS stage_name, COUNT(*)::integer AS count
        FROM crm.prospects prospect
        JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
        LEFT JOIN crm.event_occurrences occurrence
          ON occurrence.id = prospect.occurrence_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = prospect.race_listing_id
        LEFT JOIN catalog.race_editions edition
          ON edition.id = prospect.race_edition_id
        WHERE prospect.closed_at IS NULL
          AND prospect.archived_at IS NULL
          AND (
            $1::date IS NULL OR
            COALESCE(occurrence.race_date, edition.starts_at, listing.next_start_at) >=
              $1::date::timestamp AT TIME ZONE 'America/New_York'
          )
          AND (
            $2::date IS NULL OR
            COALESCE(occurrence.race_date, edition.starts_at, listing.next_start_at) <
              $2::date::timestamp AT TIME ZONE 'America/New_York'
          )
        GROUP BY stage.id
        ORDER BY stage.sort_order
      `,
      periodParameters,
    ),
  ]);
  const taskCounts = taskMetrics.rows[0];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
          Welcome back, {user.name.split(" ")[0]}
        </p>
        <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">Prospecting Dashboard</h1>
        <p className="mt-1 text-slate-600">Your leads and next actions.</p>
      </header>
      <PeriodControls period={period} />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Untouched leads" value={prospect.untouched} icon={<Search className="size-5" />} />
        <Metric label="Overdue tasks" value={taskCounts.overdue} icon={<ClockAlert className="size-5" />} />
        <Metric label="Due today" value={taskCounts.due_today} icon={<CalendarClock className="size-5" />} />
        <Metric label="Upcoming tasks" value={taskCounts.upcoming} icon={<CheckCircle2 className="size-5" />} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-4 font-bold">Next tasks</h2>
          <div className="divide-y divide-slate-100">
            {tasks.rows.map((task) => (
              <Link key={task.id} href={`/prospecting/${task.prospect_id}`} className="block px-5 py-4 hover:bg-slate-50">
                <p className="font-semibold">{formatTaskHeadline(task.title, task.notes)}</p>
                <p className="text-sm text-slate-500">{task.race_name}</p>
              </Link>
            ))}
            {!tasks.rows.length ? <p className="p-6 text-sm text-slate-500">No open tasks.</p> : null}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold">Pipeline</h2>
          <div className="mt-4 space-y-3">
            {pipeline.rows.map((stage) => (
              <div key={stage.stage_name} className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <span>{stage.stage_name}</span><strong>{stage.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
