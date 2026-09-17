import { ExternalHref } from "@/components/crm-links";
import { RefreshCw } from "lucide-react";
import { resyncBookingCatalogRacesAction } from "@/app/operations-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ExpandableDescription } from "@/components/prospecting/expandable-description";
import { UncoupleCatalogButton } from "@/components/uncouple-catalog-button";
import {
  formatOfferingClock,
  getRunVibesEventUrl,
  htmlToPlainText,
  labelPerkTag,
  labelVibeTag,
  sortPerkKeys,
  sortVibeKeys,
} from "@/lib/crm/catalog-display";
import type { CatalogOfferingRow, CatalogTagRow, ProspectDetail } from "@/lib/crm/queries";

export type CatalogOverviewFields = {
  catalog_slug: string | null;
  description_html: string | null;
  quick_take: string | null;
  city: string | null;
  state: string | null;
  location?: string | null;
  timezone: string | null;
  event_date?: string | null;
  event_date_local?: string | null;
};

function formatPart(
  value: string | null | undefined,
  timeZone: string | null,
  options: Intl.DateTimeFormatOptions,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: timeZone || "America/New_York",
  }).format(date);
}

function localClock(value: string | null | undefined) {
  const clock = value?.split("T")[1];
  return clock && clock !== "00:00" ? clock : null;
}

function TagPills({ label, tags }: { label: string; tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li
            key={tag}
            className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-900"
          >
            {tag}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListingActions({
  runVibesUrl,
  resync,
  uncouple,
}: {
  runVibesUrl: string | null;
  resync?: { bookingId: string; occurrenceId: string };
  uncouple?: { bookingId?: string; prospectId?: string };
}) {
  if (!runVibesUrl && !resync && !uncouple) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {runVibesUrl ? (
        <ExternalHref
          href={runVibesUrl}
          className="text-sm font-semibold text-cyan-700 hover:text-cyan-900"
        >
          Open on Get Run Vibes
        </ExternalHref>
      ) : null}
      {resync ? (
        <form action={resyncBookingCatalogRacesAction}>
          <input type="hidden" name="bookingId" value={resync.bookingId} />
          <input type="hidden" name="occurrenceId" value={resync.occurrenceId} />
          <PendingSubmitButton
            pendingLabel="Re-syncing…"
            className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 hover:text-cyan-900 disabled:opacity-60"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh from online listing
          </PendingSubmitButton>
        </form>
      ) : null}
      {uncouple ? (
        <UncoupleCatalogButton
          bookingId={uncouple.bookingId}
          prospectId={uncouple.prospectId}
        />
      ) : null}
    </div>
  );
}

export function CatalogEventOverview({
  listing,
  tags,
  offerings,
  variant = "standalone",
  resync,
  uncouple,
  collapsible = false,
}: {
  listing: CatalogOverviewFields;
  tags: CatalogTagRow[];
  offerings: CatalogOfferingRow[];
  variant?: "standalone" | "embedded";
  resync?: { bookingId: string; occurrenceId: string };
  uncouple?: { bookingId?: string; prospectId?: string };
  collapsible?: boolean;
}) {
  const timezone = listing.timezone;
  const dateLabel = formatPart(listing.event_date, timezone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }, "Date TBA");
  const offeringClocks = [
    ...new Set(
      offerings
        .map((offering) =>
          formatOfferingClock(offering.start_time_raw, offering.starts_at, timezone),
        )
        .filter((clock): clock is string => Boolean(clock)),
    ),
  ];
  const eventClock = localClock(listing.event_date_local)
    ? formatPart(listing.event_date, timezone, { timeStyle: "short" }, "")
    : "";
  const timeLabel =
    (eventClock && !/12:00\s*AM/i.test(eventClock) ? eventClock : null) ||
    offeringClocks.join(" / ") ||
    "Time TBA";
  const perkTags = sortPerkKeys(
    tags.filter((tag) => tag.tag_namespace === "perk").map((tag) => tag.tag_key),
  ).map(labelPerkTag);
  const vibeTags = sortVibeKeys(
    tags.filter((tag) => tag.tag_namespace === "vibe").map((tag) => tag.tag_key),
  ).map(labelVibeTag);
  const description = listing.description_html
    ? htmlToPlainText(listing.description_html)
    : "";
  const runVibesUrl = getRunVibesEventUrl(listing.catalog_slug);
  const place = [listing.city, listing.state].filter(Boolean).join(", ");
  const body = (
    <>
      {variant === "standalone" ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Event overview
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Review the Get Run Vibes listing before you reach out.
            </p>
          </div>
          <ListingActions runVibesUrl={runVibesUrl} resync={resync} uncouple={uncouple} />
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Online listing
          </h3>
          <ListingActions runVibesUrl={runVibesUrl} resync={resync} uncouple={uncouple} />
        </div>
      )}

      {variant === "standalone" ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Date</dt>
            <dd className="mt-1 font-medium text-slate-950">{dateLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Time</dt>
            <dd className="mt-1 font-medium text-slate-950">{timeLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Location</dt>
            <dd className="mt-1 font-medium text-slate-950">
              {place || listing.location || "Location unknown"}
            </dd>
          </div>
        </dl>
      ) : null}

      {listing.quick_take ? (
        <p className={`${variant === "standalone" ? "mt-4" : "mt-3"} rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700`}>
          {listing.quick_take}
        </p>
      ) : null}

      <div className="mt-5 grid gap-5">
        <TagPills label="What's included" tags={perkTags} />
        <TagPills label="Race feel" tags={vibeTags} />
        {!perkTags.length && !vibeTags.length ? (
          <p className="text-sm text-slate-500">
            No included or race-feel tags are listed for this event.
          </p>
        ) : null}

        {offerings.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Distances
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {offerings
                .map((offering, index) => {
                  const name =
                    offering.distance_label || offering.name || "Distance";
                  const clock = formatOfferingClock(
                    offering.start_time_raw,
                    offering.starts_at,
                    timezone,
                  );
                  return {
                    key: `${index}-${name}-${offering.starts_at ?? offering.start_time_raw ?? ""}`,
                    label: clock ? `${name} · ${clock}` : name,
                    dedupe: `${name}|${clock ?? ""}`,
                  };
                })
                .filter((item, index, rows) =>
                  rows.findIndex((row) => row.dedupe === item.dedupe) === index,
                )
                .map((item) => (
                  <li
                    key={item.key}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800"
                  >
                    {item.label}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Original RunSignup description
          </h3>
          <div className="mt-2">
            {description ? (
              <ExpandableDescription text={description} />
            ) : (
              <p className="text-sm text-slate-500">
                No original description is stored for this listing.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (variant === "embedded") {
    return <div className="mt-5 border-t border-slate-200 pt-5">{body}</div>;
  }

  if (collapsible) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Race details
            {listing.quick_take ? (
              <span className="mt-1 block font-normal text-slate-600">
                {listing.quick_take}
              </span>
            ) : null}
          </summary>
          <div className="mt-4">{body}</div>
        </details>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {body}
    </section>
  );
}

export function ProspectEventOverview({
  prospect,
  tags,
  offerings,
  collapsible = false,
}: {
  prospect: ProspectDetail;
  tags: CatalogTagRow[];
  offerings: CatalogOfferingRow[];
  collapsible?: boolean;
}) {
  return (
    <CatalogEventOverview
      listing={{
        catalog_slug: prospect.catalog_slug,
        description_html: prospect.description_html,
        quick_take: prospect.quick_take,
        city: prospect.city,
        state: prospect.state,
        location: prospect.location,
        timezone: prospect.timezone,
        event_date: prospect.event_date,
        event_date_local: prospect.event_date_local,
      }}
      tags={tags}
      offerings={offerings}
      uncouple={
        prospect.catalog_race_listing_id
          ? { prospectId: prospect.id }
          : undefined
      }
      collapsible={collapsible}
    />
  );
}
