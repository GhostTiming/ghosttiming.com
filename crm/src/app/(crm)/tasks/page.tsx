import { ArrowLeft, ArrowRight, Ban, CheckCircle2, Clock3 } from "lucide-react";
import Link from "next/link";
import { updateTaskStatusAction } from "@/app/actions";
import { bulkUpdateTasksAction } from "@/app/bulk-actions";
import { removeTaskAction } from "@/app/task-actions";
import { DatasetBulkBar, DatasetBulkRoot, DatasetCheckbox, DatasetHeaderCheckbox } from "@/components/dataset-bulk";
import { TaskCalendarSyncControl } from "@/components/google/task-calendar-sync-control";
import { effectiveAccessUserId } from "@/lib/auth/access";
import { requireTasksAccess } from "@/lib/auth/server";
import { taskBulkFields } from "@/lib/crm/bulk-fields";
import { formatTaskHeadline, taskRecordHref } from "@/lib/crm/domain";
import { PAGINATION_ROW } from "@/lib/crm/layout";
import { filePastProspectsWithPool, listTasks, type TaskListRow } from "@/lib/crm/queries";

export const metadata = { title: "Tasks" };

const PAGE_SIZE = 10;
const TASK_MODULES = ["overdue", "today", "upcoming", "completed"] as const;
type TaskModule = (typeof TASK_MODULES)[number];
type TaskSearchParams = Partial<Record<TaskModule, string | string[]>>;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pageFor(total: number, value: string | string[] | undefined) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number(first(value) ?? 1);
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(lastPage, Math.floor(requested));
}

function sectionHref(
  pages: Record<TaskModule, number>,
  key: TaskModule,
  page: number,
) {
  const query = new URLSearchParams();
  for (const sectionKey of TASK_MODULES) {
    const value = sectionKey === key ? page : pages[sectionKey];
    if (value > 1) query.set(sectionKey, String(value));
  }
  const qs = query.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

function TaskSection({
  title,
  module,
  tasks,
  page,
  pages,
}: {
  title: string;
  module: TaskModule;
  tasks: TaskListRow[];
  page: number;
  pages: Record<TaskModule, number>;
}) {
  const lastPage = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const visible = tasks.slice(start, start + PAGE_SIZE);
  const end = start + visible.length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <DatasetHeaderCheckbox ids={visible.map((task) => task.id)} />
        <h2 className="font-bold">
          {title}{" "}
          <span className="font-normal text-slate-400">({tasks.length})</span>
        </h2>
      </div>
      <div className="divide-y divide-slate-100">
        {visible.map((task) => (
          <article
            key={task.id}
            className="grid gap-3 px-5 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
          >
            <DatasetCheckbox id={task.id} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={taskRecordHref(task)}
                  className="font-semibold hover:text-cyan-700"
                >
                  {formatTaskHeadline(task.title, task.notes)}
                </Link>
                <TaskCalendarSyncControl
                  taskId={task.id}
                  syncStatus={task.calendar_sync_status}
                />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {task.race_name} · {formatDue(task.due_at)} · {task.assignee_name}
              </p>
              {task.notes && formatTaskHeadline(task.title, task.notes) === task.title ? (
                <p className="mt-1 text-sm">{task.notes}</p>
              ) : null}
            </div>
            {task.status === "open" ? (
              <div className="flex flex-wrap items-center gap-2">
                <form action={updateTaskStatusAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="status" value="complete" />
                  <button className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50">
                    <CheckCircle2 aria-hidden className="size-4 text-emerald-600" />
                    Complete
                  </button>
                </form>
                <form action={removeTaskAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <button
                    type="submit"
                    title="Delete task"
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                  >
                    <Ban aria-hidden className="size-4" />
                    <span className="sr-only">Delete task</span>
                  </button>
                </form>
              </div>
            ) : (
              <span className="text-sm capitalize text-slate-500">{task.status}</span>
            )}
          </article>
        ))}
        {tasks.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing here.</p>
        ) : null}
      </div>
      {tasks.length > PAGE_SIZE ? (
        <div className={PAGINATION_ROW}>
          <p className="text-slate-500">
            Showing {start + 1}–{end} of {tasks.length}
          </p>
          <div className="flex gap-2">
            <Link
              href={sectionHref(pages, module, page - 1)}
              aria-disabled={page <= 1}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-40 sm:flex-none"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Previous 10
            </Link>
            <Link
              href={sectionHref(pages, module, page + 1)}
              aria-disabled={page >= lastPage}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-40 sm:flex-none"
            >
              Next 10
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<TaskSearchParams>;
}) {
  const access = await requireTasksAccess();
  await filePastProspectsWithPool();
  const params = await searchParams;
  const tasks = await listTasks({
    userId: effectiveAccessUserId(access),
    showAll: access.isSuperAdmin,
    organizationIds: access.isSuperAdmin ? null : access.assignedOrgIds,
  });
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const sections: { key: TaskModule; title: string; tasks: TaskListRow[] }[] = [
    {
      key: "overdue",
      title: "Overdue",
      tasks: tasks.filter(
        (task) => task.status === "open" && new Date(task.due_at) < today,
      ),
    },
    {
      key: "today",
      title: "Due Today",
      tasks: tasks.filter((task) => {
        const due = new Date(task.due_at);
        return task.status === "open" && due >= today && due < tomorrow;
      }),
    },
    {
      key: "upcoming",
      title: "Upcoming",
      tasks: tasks.filter(
        (task) => task.status === "open" && new Date(task.due_at) >= tomorrow,
      ),
    },
    {
      key: "completed",
      title: "Completed / Canceled",
      tasks: tasks.filter((task) => task.status !== "open"),
    },
  ];

  const pages = Object.fromEntries(
    sections.map((section) => [
      section.key,
      pageFor(section.tasks.length, params[section.key]),
    ]),
  ) as Record<TaskModule, number>;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
          {access.isSuperAdmin
            ? "All assigned work"
            : access.assignedOrgIds.length
              ? "Assigned and in-scope work"
              : "My assigned work"}
        </p>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Clock3 aria-hidden className="size-7" />
          Tasks
        </h1>
      </div>
      <DatasetBulkRoot>
      <div className="space-y-3">
      <DatasetBulkBar
        noun="tasks"
        fields={taskBulkFields}
        updateAction={bulkUpdateTasksAction}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        {sections.map((section) => (
          <TaskSection
            key={section.key}
            title={section.title}
            module={section.key}
            tasks={section.tasks}
            page={pages[section.key]}
            pages={pages}
          />
        ))}
      </div>
      </div>
      </DatasetBulkRoot>
    </div>
  );
}
