"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { searchCrmAction } from "@/app/search-actions";
import {
  flattenSearchHits,
  partitionSearchGroups,
  SEARCH_GROUPS,
  SEARCH_MORE_GROUP_KEYS,
  SEARCH_QUERY_MIN_LENGTH,
  type SearchHit,
  type SearchGroupKey,
  type SearchGroupList,
} from "@/lib/crm/global-search";

export function GlobalSearch() {
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<SearchGroupList>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [moreKey, setMoreKey] = useState<SearchGroupKey>("contacts");
  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < SEARCH_QUERY_MIN_LENGTH;
  const { primary } = useMemo(
    () => partitionSearchGroups(tooShort || !trimmed ? [] : groups),
    [groups, tooShort, trimmed],
  );
  const more = useMemo(() => {
    if (tooShort || !trimmed) return [];
    const byKey = new Map(groups.map((group) => [group.key, group]));
    const options = SEARCH_MORE_GROUP_KEYS.map((key) => {
      const existing = byKey.get(key);
      if (existing) return existing;
      const meta = SEARCH_GROUPS.find((group) => group.key === key);
      return {
        key,
        label: meta?.label ?? "Contacts",
        hits: [] as SearchHit[],
      };
    });
    return options;
  }, [groups, tooShort, trimmed]);
  const visibleMore = more.find((group) => group.key === moreKey) ?? more[0] ?? null;
  const visibleGroups = useMemo(
    () => (visibleMore ? [...primary, visibleMore] : primary),
    [primary, visibleMore],
  );
  const hits = useMemo(
    () => flattenSearchHits(visibleGroups),
    [visibleGroups],
  );

  useEffect(() => {
    if (!more.some((group) => group.key === moreKey) && more[0]) {
      setMoreKey(more[0].key);
    }
  }, [more, moreKey]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (tooShort || !trimmed) return;
    const handle = window.setTimeout(() => {
      const current = ++requestId.current;
      setLoading(true);
      void searchCrmAction(trimmed)
        .then((result) => {
          if (current !== requestId.current) return;
          setGroups(result.groups);
          setActiveIndex(0);
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setGroups([]);
        })
        .finally(() => {
          if (current !== requestId.current) return;
          setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [tooShort, trimmed]);

  function goTo(href: string) {
    setOpen(false);
    setQuery("");
    setGroups([]);
    router.push(href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) goTo(hit.href);
    }
  }

  const showPanel = open && trimmed.length > 0;

  return (
    <div ref={rootRef} className="relative min-w-0 w-full md:min-w-[18rem] md:flex-1 md:basis-72">
      <label htmlFor={inputId} className="sr-only">
        Search CRM
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={
            showPanel && hits[activeIndex]
              ? `${listId}-${hits[activeIndex].id}`
              : undefined
          }
          placeholder="Search bookings, contacts, orgs…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-white/10 bg-white/10 py-2 pr-3 pl-9 text-sm text-white placeholder:text-slate-400 outline-none focus:border-cyan-400 focus:bg-white/15 md:pr-12"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline">
          /
        </kbd>
      </div>
      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 z-50 mt-2 max-h-[min(28rem,70vh)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 text-slate-950 shadow-xl md:inset-x-auto md:right-0 md:w-[min(36rem,calc(100vw-2rem))]"
        >
          {tooShort ? (
            <p className="px-3 py-2 text-sm text-slate-500">
              Type at least {SEARCH_QUERY_MIN_LENGTH} characters.
            </p>
          ) : loading && !groups.length ? (
            <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
          ) : !loading && !groups.length ? (
            <p className="px-3 py-2 text-sm text-slate-500">
              No matching CRM records.
            </p>
          ) : (
            <>
              {primary.map((group) => (
                <section key={group.key} className="px-1 py-1">
                  <h2 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {group.label}
                  </h2>
                  {group.hits.map((hit) => {
                    const flatIndex = hits.findIndex(
                      (item) => item.href === hit.href && item.id === hit.id,
                    );
                    const active = flatIndex === activeIndex;
                    return (
                      <button
                        key={`${group.key}-${hit.id}`}
                        id={`${listId}-${hit.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(Math.max(0, flatIndex))}
                        onClick={() => goTo(hit.href)}
                        className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left ${
                          active ? "bg-cyan-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="text-sm font-medium">{hit.label}</span>
                        {hit.secondary ? (
                          <span className="text-xs text-slate-500">
                            {hit.secondary}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </section>
              ))}
              {more.length ? (
                <section className="px-1 py-1">
                  <div className="flex items-center justify-between gap-2 px-3 py-1">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      More
                    </h2>
                    <label className="sr-only" htmlFor={`${listId}-more`}>
                      More datasets
                    </label>
                    <select
                      id={`${listId}-more`}
                      value={visibleMore?.key ?? moreKey}
                      onChange={(event) => {
                        setMoreKey(event.target.value as SearchGroupKey);
                        setActiveIndex(0);
                      }}
                      className="max-w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                    >
                      {more.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {visibleMore?.hits.length ? (
                    visibleMore.hits.map((hit) => {
                    const flatIndex = hits.findIndex(
                      (item) => item.href === hit.href && item.id === hit.id,
                    );
                    const active = flatIndex === activeIndex;
                    return (
                      <button
                        key={`${visibleMore.key}-${hit.id}`}
                        id={`${listId}-${hit.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(Math.max(0, flatIndex))}
                        onClick={() => goTo(hit.href)}
                        className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left ${
                          active ? "bg-cyan-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="text-sm font-medium">{hit.label}</span>
                        {hit.secondary ? (
                          <span className="text-xs text-slate-500">
                            {hit.secondary}
                          </span>
                        ) : null}
                      </button>
                    );
                    })
                  ) : (
                    <p className="px-3 py-2 text-sm text-slate-500">
                      No matching {visibleMore?.label.toLowerCase() ?? "records"}.
                    </p>
                  )}
                </section>
              ) : null}
            </>
          )}
          {loading && groups.length ? (
            <p className="px-3 py-1 text-xs text-slate-400">Updating…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
