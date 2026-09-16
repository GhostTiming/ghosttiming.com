"use client";

import { ListFilter } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useSyncExternalStore } from "react";
import { US_STATES } from "@/lib/crm/geo";
import { buildSearchHref } from "@/lib/crm/search-params";

type ProspectingLocationFilterProps = {
  params: Record<string, string | undefined>;
};

const FILTER_KEYS = ["state", "city", "zip", "miles"] as const;
const emptySubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function isLocationFilterActive(
  params: Record<string, string | undefined>,
) {
  return FILTER_KEYS.some((key) => Boolean(params[key]));
}

function preservedParams(params: Record<string, string | undefined>) {
  return Object.entries(params).filter(([key, value]) => {
    if (!value) return false;
    if (FILTER_KEYS.includes(key as (typeof FILTER_KEYS)[number])) return false;
    if (key === "page") return false;
    if ((key === "phone" || key === "email") && value === "all") return false;
    if (key === "direction" && value === "asc") return false;
    return true;
  });
}

export function ProspectingLocationFilter({
  params,
}: ProspectingLocationFilterProps) {
  const mounted = useIsClient();
  const reactId = useId().replace(/:/g, "");
  const popoverId = `prospecting-location-filter-${reactId}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const active = isLocationFilterActive(params);
  const clearHref = buildSearchHref(
    "/prospecting",
    params,
    Object.fromEntries([...FILTER_KEYS, "page"].map((name) => [name, null])),
  );

  function positionPopover() {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8),
    );
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${left}px`;
    popover.style.width = `${width}px`;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium ring-1 md:w-auto md:justify-start md:rounded-md md:py-1.5 ${
          active
            ? "bg-cyan-700 text-white ring-cyan-700"
            : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
        }`}
      >
        <ListFilter aria-hidden className="size-3.5" />
        {active ? "Location filter on" : "Filter by location"}
      </button>
      {mounted ? (
        <div
          ref={popoverRef}
          id={popoverId}
          popover="auto"
          role="dialog"
          aria-label="Filter by location"
          onToggle={(event) => {
            if (event.newState === "open") positionPopover();
          }}
          className="m-0 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg"
        >
          <form
            action="/prospecting"
            method="get"
            className="grid gap-2"
            onSubmit={(event) => {
              for (const element of Array.from(event.currentTarget.elements)) {
                if (
                  !(element instanceof HTMLInputElement) &&
                  !(element instanceof HTMLSelectElement)
                ) {
                  continue;
                }
                if (!element.value.trim()) element.disabled = true;
              }
              popoverRef.current?.hidePopover();
            }}
          >
            {preservedParams(params).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <label className="text-xs font-medium text-slate-600">
              State
              <select
                name="state"
                defaultValue={params.state ?? ""}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              >
                <option value="">Any state</option>
                {US_STATES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              City
              <input
                name="city"
                defaultValue={params.city ?? ""}
                placeholder="Chapel Hill"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              ZIP code
              <input
                name="zip"
                inputMode="numeric"
                defaultValue={params.zip ?? ""}
                placeholder="27514"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Within miles of ZIP
              <input
                name="miles"
                type="number"
                min={1}
                defaultValue={params.miles ?? ""}
                placeholder="25"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
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
        </div>
      ) : null}
    </>
  );
}
