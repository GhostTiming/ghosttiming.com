"use client";

import { useEffect, useState } from "react";
import { createBookingFromOnlineListingAction } from "@/app/booking-actions";
import { searchCatalogListingsAction } from "@/app/catalog-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { listingEventYear } from "@/lib/crm/catalog-search";
import type { OnlineListing } from "@/lib/crm/online-listing-types";
import { shouldSearchOnlineListings } from "@/lib/crm/runsignup-parse";

function listingPlace(listing: OnlineListing) {
  const cityState = [listing.city, listing.state].filter(Boolean).join(", ");
  const place = [cityState, listing.zipcode].filter(Boolean).join(" ") || "Location unknown";
  const year = listingEventYear(listing.next_start_at, listing.edition_year);
  return `${place}${year ? ` · ${year}` : ""} · ${listing.source_label}`;
}

export function CreateFromOnlineEvent({
  organizations,
  people,
  users,
  stages,
  canViewFinancials,
}: {
  organizations: Array<{ id: string; name: string }>;
  people: Array<{ id: string; display_name: string }>;
  users: Array<{ id: string; name: string }>;
  stages: Array<{ key: string; name: string }>;
  canViewFinancials: boolean;
}) {
  const [query, setQuery] = useState("");
  const [listings, setListings] = useState<OnlineListing[]>([]);
  const [remoteQuery, setRemoteQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [directClientId, setDirectClientId] = useState("");
  const [eventOwnerId, setEventOwnerId] = useState("");
  const [primaryContactPersonId, setPrimaryContactPersonId] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [stageKey, setStageKey] = useState("confirmed");
  const [expectedRevenue, setExpectedRevenue] = useState("");
  const canSearch = shouldSearchOnlineListings(query);
  const searching = canSearch && remoteQuery !== query.trim();
  const visibleListings = canSearch ? listings : [];

  useEffect(() => {
    const requested = query.trim();
    if (!shouldSearchOnlineListings(requested)) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void searchCatalogListingsAction(requested)
        .then((rows) => {
          if (cancelled) return;
          setListings(rows);
          setRemoteQuery(requested);
          setSearchError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteQuery(requested);
          setSearchError("Could not search online listings.");
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-lg font-bold text-slate-950">Create from online event</h2>
        <p className="mt-1 text-sm text-slate-600">
          Search the online catalog or RunSignUp, or paste a RunSignUp or Race
          Roster link. Choose the Direct client, click the event, and the
          booking fields fill in from that listing.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          Direct client
          <select
            required
            value={directClientId}
            onChange={(event) => setDirectClientId(event.target.value)}
            className={field}
          >
            <option value="">Choose organization</option>
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Stage
          <select
            value={stageKey}
            onChange={(event) => setStageKey(event.target.value)}
            className={field}
          >
            {stages.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Event owner
          <select
            value={eventOwnerId}
            onChange={(event) => setEventOwnerId(event.target.value)}
            className={field}
          >
            <option value="">None</option>
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Primary contact
          <select
            value={primaryContactPersonId}
            onChange={(event) => setPrimaryContactPersonId(event.target.value)}
            className={field}
          >
            <option value="">None</option>
            {people.map((item) => (
              <option key={item.id} value={item.id}>
                {item.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Assignee
          <select
            value={assignedUserId}
            onChange={(event) => setAssignedUserId(event.target.value)}
            className={field}
          >
            <option value="">Me</option>
            {users.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {canViewFinancials ? (
          <label className="text-sm">
            Expected revenue
            <input
              type="number"
              min="0"
              step="0.01"
              value={expectedRevenue}
              onChange={(event) => setExpectedRevenue(event.target.value)}
              className={field}
            />
          </label>
        ) : null}
        <label className="text-sm md:col-span-2">
          Search events
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Event name or RunSignUp / Race Roster URL…"
            className={field}
          />
        </label>
      </div>
      {searchError ? (
        <p className="text-sm text-red-700" role="alert">
          {searchError}
        </p>
      ) : null}
      {searching ? (
        <p className="text-sm text-slate-500">Searching online listings…</p>
      ) : null}
      {!directClientId && visibleListings.length ? (
        <p className="text-sm text-amber-800">
          Choose a Direct client before creating the booking.
        </p>
      ) : null}
      {visibleListings.length ? (
        <ul className="space-y-2">
          {visibleListings.map((listing) => (
            <li
              key={listing.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
            >
              <div>
                <p className="font-medium text-slate-950">{listing.name}</p>
                <p className="text-xs text-slate-500">{listingPlace(listing)}</p>
              </div>
              <form action={createBookingFromOnlineListingAction}>
                <input type="hidden" name="listingId" value={listing.id} />
                <input type="hidden" name="directClientId" value={directClientId} />
                <input type="hidden" name="eventOwnerId" value={eventOwnerId} />
                <input
                  type="hidden"
                  name="primaryContactPersonId"
                  value={primaryContactPersonId}
                />
                <input type="hidden" name="assignedUserId" value={assignedUserId} />
                <input type="hidden" name="stageKey" value={stageKey} />
                {expectedRevenue ? (
                  <input type="hidden" name="expectedRevenue" value={expectedRevenue} />
                ) : null}
                <PendingSubmitButton
                  disabled={!directClientId}
                  className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
                >
                  Use this event
                </PendingSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : query.trim() && !searching ? (
        <p className="text-sm text-slate-500">No online listings match that search.</p>
      ) : null}
    </section>
  );
}
