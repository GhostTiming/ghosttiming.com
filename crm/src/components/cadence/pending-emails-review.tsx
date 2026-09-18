"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  approveCadenceSendAction,
  declineCadenceSendAction,
} from "@/app/cadence-actions";
import {
  cadenceStepLabel,
  type PendingCadenceSend,
} from "@/lib/crm/cadence-copy";

export function PendingEmailsReview({ rows }: { rows: PendingCadenceSend[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    sendId: string,
    action: (formData: FormData) => Promise<{ message: string }>,
  ) {
    setBusyId(sendId);
    setError(null);
    const data = new FormData();
    data.set("sendId", sendId);
    try {
      await action(data);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update that email.");
    } finally {
      setBusyId(null);
    }
  }

  if (!rows.length) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        No cadence emails are due right now.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {rows.map((row) => (
        <article
          key={row.send_id}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">
                {cadenceStepLabel(row.step_order, row.step_count)} · {row.cadence_name}
              </p>
              <Link
                href={`/prospecting/${row.prospect_id}`}
                className="mt-1 block text-lg font-bold text-slate-950 hover:text-cyan-800"
              >
                {row.race_name}
              </Link>
              <p className="mt-1 text-sm text-slate-600">
                To: {row.to_addresses.join(", ") || "No recipient"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyId === row.send_id || !row.to_addresses.length}
                onClick={() => void run(row.send_id, approveCadenceSendAction)}
                className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busyId === row.send_id ? "Sending…" : "Approve"}
              </button>
              <button
                type="button"
                disabled={busyId === row.send_id}
                onClick={() => void run(row.send_id, declineCadenceSendAction)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-900">{row.subject}</p>
          <div
            className="prose prose-sm mt-3 max-w-none text-slate-700"
            dangerouslySetInnerHTML={{ __html: row.body_html }}
          />
        </article>
      ))}
    </div>
  );
}
