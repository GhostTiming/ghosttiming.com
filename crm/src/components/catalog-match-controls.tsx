"use client";

import { useEffect, useMemo, useState } from "react";
import { searchCatalogListingsAction } from "@/app/catalog-actions";
import {
  dismissBookingCatalogMatchAction,
  matchBookingCatalogListingAction,
} from "@/app/booking-actions";
import {
  dismissProspectCatalogMatchAction,
  matchProspectCatalogListingAction,
} from "@/app/prospect-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type {
  CatalogListingCandidate,
  CatalogListingSuggestion,
} from "@/lib/crm/catalog-link";
import {
  catalogSearchLikeNeedles,
  listingEventYear,
  listingMatchesSearch,
} from "@/lib/crm/catalog-search";

function listingPlace(listing: {
  city: string | null;
  state: string | null;
  zipcode?: string | null;
  next_start_at?: string | Date | null;
  edition_year?: number | null;
}) {
  const cityState = [listing.city, listing.state].filter(Boolean).join(", ");
  const place = [cityState, listing.zipcode].filter(Boolean).join(" ") || "Location unknown";
  const year = listingEventYear(listing.next_start_at, listing.edition_year);
  return year ? `${place} · ${year}` : place;
}

function asSuggestion(
  listing: CatalogListingCandidate | CatalogListingSuggestion,
): CatalogListingSuggestion {
  if ("reason" in listing) return listing;
  return { ...listing, score: 50, reason: "similar" };
}

const EMPTY_SUGGESTIONS: CatalogListingSuggestion[] = [];

function uniqueListings(rows: CatalogListingSuggestion[]) {
  const seen = new Set<string>();
  const unique: CatalogListingSuggestion[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

export function CatalogMatchControls({
  bookingId,
  prospectId,
  suggestions,
  searchResults = EMPTY_SUGGESTIONS,
  searchQuery = "",
  returnTo,
  compact = false,
}: {
  bookingId?: string;
  prospectId?: string;
  suggestions: CatalogListingSuggestion[];
  searchResults?: CatalogListingSuggestion[];
  searchQuery?: string;
  returnTo?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(searchQuery);
  const [remote, setRemote] = useState<CatalogListingCandidate[]>(searchResults);
  const [remoteQuery, setRemoteQuery] = useState(searchQuery);
  const [searchError, setSearchError] = useState<string | null>(null);
  const needles = catalogSearchLikeNeedles(query);
  const searching = needles.length > 0 && remoteQuery !== query.trim();

  useEffect(() => {
    const requested = query.trim();
    const searchNeedles = catalogSearchLikeNeedles(requested);
    if (!searchNeedles.length) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void searchCatalogListingsAction(requested)
        .then((rows) => {
          if (cancelled) return;
          setRemote(rows);
          setRemoteQuery(requested);
          setSearchError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteQuery(requested);
          setSearchError("Could not search listings.");
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const listings = useMemo(() => {
    const pooled = uniqueListings([
      ...suggestions,
      ...searchResults,
      ...remote.map(asSuggestion),
    ]);
    if (!query.trim()) return suggestions;
    return pooled
      .filter((listing) => listingMatchesSearch(listing, query))
      .sort((left, right) => {
        const yearLeft = Number(
          listingEventYear(left.next_start_at, left.edition_year) ?? 0,
        );
        const yearRight = Number(
          listingEventYear(right.next_start_at, right.edition_year) ?? 0,
        );
        return yearRight - yearLeft;
      })
      .slice(0, 50);
  }, [query, remote, searchResults, suggestions]);

  const emptyLabel = query.trim()
    ? searching
      ? "Searching Get Run Vibes…"
      : "No Get Run Vibes listings match that search."
    : "No close Get Run Vibes matches.";
  const matchAction = prospectId
    ? matchProspectCatalogListingAction
    : matchBookingCatalogListingAction;
  const dismissAction = prospectId
    ? dismissProspectCatalogMatchAction
    : dismissBookingCatalogMatchAction;

  function entityFields() {
    return (
      <>
        {bookingId ? <input type="hidden" name="bookingId" value={bookingId} /> : null}
        {prospectId ? <input type="hidden" name="prospectId" value={prospectId} /> : null}
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      </>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <label className="block">
        <span className="sr-only">Search listings</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, location, year, or GRV id…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      {searchError && needles.length ? (
        <p className="text-sm text-red-700" role="alert">
          {searchError}
        </p>
      ) : null}
      {listings.length ? (
        <ul className="space-y-2">
          {listings.map((listing) => (
            <li
              key={listing.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
            >
              <div>
                <p className="font-medium text-slate-950">{listing.name}</p>
                <p className="text-xs text-slate-500">
                  {listingPlace(listing)}
                  {listing.taken
                    ? " · Already booked"
                    : listing.reason === "exact"
                      ? " · Same name"
                      : " · Similar"}
                </p>
              </div>
              {listing.taken ? (
                <span className="text-xs font-semibold text-slate-500">Booked</span>
              ) : (
                <form action={matchAction}>
                  {entityFields()}
                  <input type="hidden" name="listingId" value={listing.id} />
                  <PendingSubmitButton className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">
                    Match
                  </PendingSubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      )}

      <form action={dismissAction}>
        {entityFields()}
        <PendingSubmitButton className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-60">
          Not in Get Run Vibes
        </PendingSubmitButton>
      </form>
    </div>
  );
}
