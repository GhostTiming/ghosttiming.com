"use client";

import { ListFilter } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useSyncExternalStore } from "react";
import { prospectPerkFilters } from "@/lib/crm/catalog-display";
import { US_STATES } from "@/lib/crm/geo";
import { buildSearchHref } from "@/lib/crm/search-params";

type ProspectingLocationFilterProps = {
  params: Record<string, string | undefined>;
};

const FILTER_KEYS = [
  "state",
  "city",
  "zip",
  "miles",
  "eventFrom",
  "eventTo",
  "hasPerk",
  "missingPerk",
] as const;
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

function perkValue(
  params: Record<string, string | undefined>,
  key: string,
) {
  const has = new Set((params.hasPerk ?? "").split(",").filter(Boolean));
  const missing = new Set((params.missingPerk ?? "").split(",").filter(Boolean));
  if (has.has(key)) return "has";
  if (missing.has(key)) return "missing";
  return "";
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
    const width = 320;
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    popover.style.width = `${width}px`;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ring-1 ${
          active
            ? "bg-cyan-700 text-white ring-cyan-700"
            : "bg-white ring-slate-200 hover:bg-slate-50"
        }`}
      >
        <ListFilter aria-hidden className="size-3.5" />
        Filter
      </button>
      {mounted ? (
        <div
          ref={popoverRef}
          id={popoverId}
          popover="auto"
          role="dialog"
          aria-label="Filter prospects"
          onToggle={(event) => {
            if (event.newState === "open") positionPopover();
          }}
          className="m-0 max-h-[min(80vh,36rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg"
        >
          <form
            action="/prospecting"
            method="get"
            className="grid gap-2"
            onSubmit={(event) => {
              const form = event.currentTarget;
              const has: string[] = [];
              const missing: string[] = [];
              for (const perk of prospectPerkFilters) {
                const field = form.elements.namedItem(`perk_${perk.key}`);
                if (!(field instanceof HTMLSelectElement)) continue;
                if (field.value === "has") has.push(perk.key);
                if (field.value === "missing") missing.push(perk.key);
                field.disabled = true;
              }
              const hasInput = form.elements.namedItem("hasPerk");
              const missingInput = form.elements.namedItem("missingPerk");
              if (hasInput instanceof HTMLInputElement) {
                hasInput.value = has.join(",");
                if (!has.length) hasInput.disabled = true;
              }
              if (missingInput instanceof HTMLInputElement) {
                missingInput.value = missing.join(",");
                if (!missing.length) missingInput.disabled = true;
              }
              for (const element of Array.from(form.elements)) {
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
            <input type="hidden" name="hasPerk" defaultValue={params.hasPerk ?? ""} />
            <input type="hidden" name="missingPerk" defaultValue={params.missingPerk ?? ""} />
            <label className="text-xs font-medium text-slate-600">
              Event from
              <input
                type="date"
                name="eventFrom"
                defaultValue={params.eventFrom ?? ""}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Event to
              <input
                type="date"
                name="eventTo"
                defaultValue={params.eventTo ?? ""}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
              What’s included
            </p>
            {prospectPerkFilters.map((perk) => (
              <label key={perk.key} className="text-xs font-medium text-slate-600">
                {perk.label}
                <select
                  name={`perk_${perk.key}`}
                  defaultValue={perkValue(params, perk.key)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                >
                  <option value="">Any</option>
                  <option value="has">Has it</option>
                  <option value="missing">Missing it</option>
                </select>
              </label>
            ))}
            <label className="pt-1 text-xs font-medium text-slate-600">
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
