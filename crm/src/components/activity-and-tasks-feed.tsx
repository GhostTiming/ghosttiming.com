"use client";

import { useState, type ReactNode } from "react";

const filters = [
  { key: "both", label: "Both" },
  { key: "tasks", label: "Tasks" },
  { key: "activities", label: "Activities" },
] as const;

type FeedFilter = (typeof filters)[number]["key"];

export function ActivityAndTasksFeed({
  taskCount,
  activityCount,
  addTask,
  children,
}: {
  taskCount: number;
  activityCount: number;
  addTask?: ReactNode;
  children: ReactNode;
}) {
  const [filter, setFilter] = useState<FeedFilter>("both");
  const empty =
    filter === "tasks"
      ? taskCount === 0
      : filter === "activities"
        ? activityCount === 0
        : taskCount === 0 && activityCount === 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold">Activity and tasks</h2>
        <div
          role="tablist"
          aria-label="Filter activity and tasks"
          className="flex rounded-lg bg-slate-100 p-1"
        >
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                filter === item.key
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-950"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`mt-4 space-y-4 ${
          filter === "tasks"
            ? "[&_[data-feed-kind=activity]]:hidden"
            : filter === "activities"
              ? "[&_[data-feed-kind=task]]:hidden"
              : ""
        }`}
      >
        {children}
        {empty ? (
          <p className="text-sm text-slate-500">
            {filter === "tasks"
              ? "No tasks yet."
              : filter === "activities"
                ? "No activity yet."
                : "No activity or tasks yet."}
          </p>
        ) : null}
      </div>
      {filter !== "activities" && addTask ? (
        <div className="mt-4">{addTask}</div>
      ) : null}
    </section>
  );
}
