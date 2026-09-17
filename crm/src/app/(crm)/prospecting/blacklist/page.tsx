import { ArrowLeft, Ban } from "lucide-react";
import Link from "next/link";
import { deleteEmailBlacklistAction } from "@/app/blacklist-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { EmailBlacklistForm } from "@/components/prospecting/email-blacklist-form";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import { disqualifiedReasonLabels, type DisqualifiedReason } from "@/lib/crm/domain";
import {
  formatBlacklistPattern,
  listEmailBlacklist,
} from "@/lib/crm/email-blacklist";
import { DESKTOP_TABLE, MOBILE_CARDS } from "@/lib/crm/layout";

export const metadata = { title: "Email blacklist" };

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(date);
}

export default async function EmailBlacklistPage() {
  await requireProspectingUser();
  const entries = await listEmailBlacklist(getPool());

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/prospecting"
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-950"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to prospecting
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Ban aria-hidden className="size-7 text-cyan-700" />
          Email blacklist
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Events with a blacklisted email are disqualified automatically, including
          candidates already in the funnel. Use a full address for one organizer,
          or @domain.com to catch every race from that company.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Add address
        </h2>
        <div className="mt-3">
          <EmailBlacklistForm />
        </div>
      </section>

      <section>
        {entries.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            No blacklisted emails yet.
          </p>
        ) : (
          <>
          <div className={MOBILE_CARDS}>
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="font-medium text-slate-950">{formatBlacklistPattern(entry)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {entry.matchKind === "domain" ? "Any email at this domain" : "Exact email"}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {disqualifiedReasonLabels[entry.reason as DisqualifiedReason] ?? entry.reason}
                </p>
                <p className="mt-1 text-sm text-slate-500">{entry.note || "No notes"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Added {formatDate(entry.createdAt)}
                  {entry.createdByName ? ` · ${entry.createdByName}` : ""}
                </p>
                <form action={deleteEmailBlacklistAction} className="mt-3">
                  <input type="hidden" name="id" value={entry.id} />
                  <PendingSubmitButton
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                    pendingLabel="Removing…"
                  >
                    Remove
                  </PendingSubmitButton>
                </form>
              </article>
            ))}
          </div>
          <section className={DESKTOP_TABLE}>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Email / domain</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3" aria-label="Remove" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-950">
                    {formatBlacklistPattern(entry)}
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      {entry.matchKind === "domain" ? "Any email at this domain" : "Exact email"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {disqualifiedReasonLabels[entry.reason as DisqualifiedReason] ??
                      entry.reason}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{entry.note || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {formatDate(entry.createdAt)}
                    {entry.createdByName ? (
                      <span className="mt-0.5 block text-xs">{entry.createdByName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={deleteEmailBlacklistAction}>
                      <input type="hidden" name="id" value={entry.id} />
                      <PendingSubmitButton
                        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                        pendingLabel="Removing…"
                      >
                        Remove
                      </PendingSubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </section>
          </>
        )}
      </section>
    </div>
  );
}
