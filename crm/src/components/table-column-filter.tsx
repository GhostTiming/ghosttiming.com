"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useSyncExternalStore } from "react";
import { buildSearchHref } from "@/lib/crm/search-params";

export type TableFilterField =
  | {
      type: "text";
      name: string;
      label?: string;
      placeholder?: string;
    }
  | {
      type: "number";
      name: string;
      label?: string;
      placeholder?: string;
      min?: number;
    }
  | {
      type: "select";
      name: string;
      label?: string;
      options: { value: string; label: string }[];
    }
  | {
      type: "date";
      name: string;
      label?: string;
    }
  | {
      type: "date-range";
      fromName: string;
      toName: string;
      fromLabel?: string;
      toLabel?: string;
    };

export type TableQueryParams = Record<string, string | undefined>;

const emptySubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function FunnelIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M3 5h18M7 12h10M10 19h4" />
    </svg>
  );
}

const fieldInputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900";

function fieldNames(fields: TableFilterField[]) {
  return fields.flatMap((field) =>
    field.type === "date-range" ? [field.fromName, field.toName] : [field.name],
  );
}

function isMeaningful(value: string | undefined) {
  return Boolean(value) && value !== "all";
}

export function isFilterActive(
  params: TableQueryParams,
  fields: TableFilterField[],
) {
  return fieldNames(fields).some((name) => isMeaningful(params[name]));
}

type TableColumnFilterProps = {
  label: string;
  pathname: string;
  params: TableQueryParams;
  filters: TableFilterField[];
  align?: "left" | "right";
};

export function TableColumnFilter({
  label,
  pathname,
  params,
  filters,
  align = "left",
}: TableColumnFilterProps) {
  const router = useRouter();
  const mounted = useIsClient();
  const reactId = useId().replace(/:/g, "");
  const popoverId = `column-filter-${reactId}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const names = fieldNames(filters);
  const active = isFilterActive(params, filters);
  const clearHref = buildSearchHref(
    pathname,
    params,
    Object.fromEntries([...names, "page"].map((name) => [name, null])),
  );

  function positionPopover() {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;
    const rect = button.getBoundingClientRect();
    const width = 256;
    const left =
      align === "right"
        ? Math.min(rect.right - width, window.innerWidth - width - 8)
        : rect.left;
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.max(8, left)}px`;
    popover.style.width = `${width}px`;
  }

  function applyFilter() {
    const popover = popoverRef.current;
    if (!popover) return;
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!value || names.includes(key) || key === "page") continue;
      if (value === "all") continue;
      if (key === "direction" && value === "asc") continue;
      next.set(key, value);
    }
    for (const element of Array.from(
      popover.querySelectorAll("input, select"),
    )) {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLSelectElement)
      ) {
        continue;
      }
      const value = element.value.trim();
      if (!value || value === "all") next.delete(element.name);
      else next.set(element.name, value);
    }
    const qs = next.toString();
    popover.hidePopover();
    window.dispatchEvent(new Event("crm:navigate"));
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        aria-label={`Filter ${label}`}
        className={`rounded p-0.5 ${
          active
            ? "bg-cyan-100 text-cyan-800"
            : "text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        }`}
      >
        <FunnelIcon />
      </button>
      {mounted ? (
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-label={`Filter ${label}`}
        onToggle={(event) => {
          if (event.newState === "open") positionPopover();
        }}
        className="m-0 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
      >
        <div
          className="grid gap-2 font-normal normal-case tracking-normal"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyFilter();
            }
          }}
        >
          {filters.map((field) => (
            <FilterField
              key={field.type === "date-range" ? field.fromName : field.name}
              field={field}
              params={params}
            />
          ))}
          <div className="mt-1 flex items-center justify-between gap-2">
            <Link
              href={clearHref}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Clear
            </Link>
            <button
              type="button"
              onClick={applyFilter}
              className="rounded-md bg-cyan-700 px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
      ) : null}
    </>
  );
}

function FilterField({
  field,
  params,
}: {
  field: TableFilterField;
  params: TableQueryParams;
}) {
  if (field.type === "date-range") {
    return (
      <div className="grid gap-2">
        <label className="text-xs font-medium text-slate-600">
          {field.fromLabel ?? "From"}
          <input
            type="date"
            name={field.fromName}
            defaultValue={params[field.fromName] ?? ""}
            className={fieldInputClass}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          {field.toLabel ?? "To"}
          <input
            type="date"
            name={field.toName}
            defaultValue={params[field.toName] ?? ""}
            className={fieldInputClass}
          />
        </label>
      </div>
    );
  }

  const label = field.label ?? "Contains";
  if (field.type === "select") {
    return (
      <label className="text-xs font-medium text-slate-600">
        {label}
        <select
          name={field.name}
          defaultValue={params[field.name] ?? "all"}
          className={fieldInputClass}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <input
        type={field.type}
        name={field.name}
        min={field.type === "number" ? field.min : undefined}
        placeholder={
          field.type === "date" ? undefined : (field.placeholder ?? "Filter…")
        }
        defaultValue={params[field.name] ?? ""}
        className={fieldInputClass}
      />
    </label>
  );
}
