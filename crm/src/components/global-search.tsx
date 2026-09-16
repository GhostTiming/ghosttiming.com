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
  SEARCH_QUERY_MIN_LENGTH,
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
  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < SEARCH_QUERY_MIN_LENGTH;
  const hits = useMemo(
    () => flattenSearchHits(tooShort || !trimmed ? [] : groups),
    [groups, tooShort, trimmed],
  );

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
    <div ref={rootRef} className="relative min-w-0 flex-1">
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
          className="w-full rounded-lg border border-white/10 bg-white/10 py-2 pr-12 pl-9 text-sm text-white placeholder:text-slate-400 outline-none focus:border-cyan-400 focus:bg-white/15"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline">
          /
        </kbd>
      </div>
      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-2 max-h-[min(28rem,70vh)] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 text-slate-950 shadow-xl"
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
            groups.map((group) => (
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
            ))
          )}
          {loading && groups.length ? (
            <p className="px-3 py-1 text-xs text-slate-400">Updating…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
