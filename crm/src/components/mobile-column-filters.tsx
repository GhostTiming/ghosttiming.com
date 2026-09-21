"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ListFilter } from "lucide-react";
import {
  FilterField,
  applyColumnFilters,
  fieldNames,
  isFilterActive,
  type TableFilterField,
  type TableQueryParams,
} from "@/components/table-column-filter";
import { buildSearchHref } from "@/lib/crm/search-params";

export function MobileColumnFilters({
  pathname,
  params,
  filters,
  ariaLabel = "List filters",
}: {
  pathname: string;
  params: TableQueryParams;
  filters: TableFilterField[];
  ariaLabel?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const active = isFilterActive(params, filters);
  const [open, setOpen] = useState(active);
  const names = fieldNames(filters);
  const clearHref = buildSearchHref(
    pathname,
    params,
    Object.fromEntries([...names, "page"].map((name) => [name, null])),
  );

  if (!filters.length) return null;

  function apply() {
    const form = formRef.current;
    if (!form) return;
    const formValues: Record<string, string> = {};
    for (const element of Array.from(form.elements)) {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLSelectElement)
      ) {
        continue;
      }
      if (!element.name) continue;
      formValues[element.name] = element.value;
    }
    window.dispatchEvent(new Event("crm:navigate"));
    router.push(applyColumnFilters({ pathname, params, fields: filters, formValues }));
  }

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-column-filters"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-3 text-sm font-semibold ring-1 ${
          active
            ? "bg-cyan-700 text-white ring-cyan-700"
            : "bg-white text-slate-800 ring-slate-200"
        }`}
      >
        <ListFilter aria-hidden className="size-3.5" />
        {active ? "Filters on" : ariaLabel}
      </button>
      {open ? (
        <form
          id="mobile-column-filters"
          ref={formRef}
          className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
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
              type="submit"
              className="rounded-md bg-cyan-700 px-2.5 py-1.5 text-xs font-semibold text-white"
            >
              Apply
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
