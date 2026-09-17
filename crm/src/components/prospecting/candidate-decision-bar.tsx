"use client";

import { useState } from "react";
import { startProspectAction } from "@/app/candidate-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { OutcomeReasonPrompt } from "@/components/prospecting/outcome-reason-prompt";
import {
  disqualifiedReasonLabels,
  disqualifiedReasons,
  unqualifiedReasonLabels,
  unqualifiedReasons,
} from "@/lib/crm/domain";

export function CandidateDecisionBar({ raceListingId }: { raceListingId: string }) {
  const [outcome, setOutcome] = useState<"unqualified" | "disqualified" | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <form action={startProspectAction}>
          <input type="hidden" name="raceListingId" value={raceListingId} />
          <PendingSubmitButton
            pendingLabel="Starting…"
            savedLabel="Started"
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Start
          </PendingSubmitButton>
        </form>
        <button
          type="button"
          onClick={() => setOutcome("disqualified")}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Disqualify
        </button>
        <button
          type="button"
          onClick={() => setOutcome("unqualified")}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Unqualified
        </button>
      </div>
      {outcome ? (
        <OutcomeReasonPrompt
          raceListingId={raceListingId}
          stageKey={outcome}
          title={outcome === "unqualified" ? "Mark unqualified" : "Disqualify"}
          description={
            outcome === "unqualified"
              ? "Choose why this race is unqualified."
              : "Choose why this race is disqualified."
          }
          reasons={
            outcome === "unqualified"
              ? unqualifiedReasons.map((key) => ({
                  key,
                  label: unqualifiedReasonLabels[key],
                }))
              : disqualifiedReasons.map((key) => ({
                  key,
                  label: disqualifiedReasonLabels[key],
                }))
          }
          submitLabel={outcome === "unqualified" ? "Unqualify" : "Disqualify"}
          onCancel={() => setOutcome(null)}
        />
      ) : null}
    </>
  );
}
