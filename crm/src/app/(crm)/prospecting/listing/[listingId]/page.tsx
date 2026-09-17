import { ArrowLeft, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MailtoLink } from "@/components/crm-links";
import { EventLogo } from "@/components/event-logo";
import { CandidateDecisionBar } from "@/components/prospecting/candidate-decision-bar";
import { CatalogEventOverview } from "@/components/prospecting/event-overview";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import { applyEmailBlacklist } from "@/lib/crm/email-blacklist";
import { getCandidateListing } from "@/lib/crm/queries";

export const metadata = { title: "Candidate lead" };

function formatDate(value: string | null | undefined) {
  if (!value) return "Date TBA";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      }).format(date);
}

export default async function CandidateListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const user = await requireProspectingUser();
  const { listingId } = await params;
  const decodedId = decodeURIComponent(listingId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await applyEmailBlacklist(client, user, { listingIds: [decodedId] });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Email blacklist apply on candidate lead failed", error);
  } finally {
    client.release();
  }
  const data = await getCandidateListing(decodedId);
  if (!data) notFound();
  if (data.existingProspectId) {
    redirect(`/prospecting/${data.existingProspectId}`);
  }
  const phone = data.contacts.find((contact) => contact.type === "phone")?.raw_value;
  const email = data.contacts.find((contact) => contact.type === "email")?.raw_value;

  return (
    <div className="space-y-6">
      <Link
        href="/prospecting?view=candidate"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to candidates
      </Link>

      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <EventLogo url={data.listing.logo_url} name={data.listing.name} size="header" />
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
                Candidate
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">
                {data.listing.name}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {formatDate(data.listing.next_start_at)}
                {data.listing.location ? ` · ${data.listing.location}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
                {phone ? (
                  <span className="inline-flex items-center gap-1">
                    <Phone aria-hidden className="size-4" />
                    {phone}
                  </span>
                ) : null}
                {email ? (
                  <span className="inline-flex items-center gap-1">
                    <Mail aria-hidden className="size-4" />
                    <MailtoLink email={email} className="font-medium text-cyan-700 hover:text-cyan-900" />
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <CandidateDecisionBar raceListingId={data.listing.id} />
        </div>
      </header>

      <CatalogEventOverview
        listing={{
          catalog_slug: data.listing.catalog_slug,
          description_html: data.listing.description_html,
          quick_take: data.listing.quick_take,
          city: data.listing.city,
          state: data.listing.state,
          location: data.listing.location,
          timezone: data.listing.timezone,
          event_date: data.listing.next_start_at,
        }}
        tags={data.tags}
        offerings={data.offerings}
      />
    </div>
  );
}
