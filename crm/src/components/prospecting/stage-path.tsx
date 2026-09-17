"use client";

import { useState } from "react";
import { updateProspectStageAction } from "@/app/prospect-actions";
import { PipelineStagePath } from "@/components/pipeline-stage-path";
import { ClosedLostPrompt } from "@/components/prospecting/closed-lost-prompt";
import { ConvertToBookingPrompt } from "@/components/prospecting/convert-to-booking-prompt";
import { OutcomeReasonPrompt } from "@/components/prospecting/outcome-reason-prompt";
import {
  disqualifiedReasonLabels,
  disqualifiedReasons,
  unqualifiedReasonLabels,
  unqualifiedReasons,
} from "@/lib/crm/domain";
import type { StageRow } from "@/lib/crm/queries";

export type ConvertBookingOptions = {
  directClients: Array<{ id: string; name: string }>;
  organizations: Array<{ id: string; name: string }>;
  canViewFinancials: boolean;
};

export function ProspectStagePath({
  prospectId,
  currentStageKey,
  stages,
  variant = "card",
  convertToBooking,
}: {
  prospectId: string;
  currentStageKey: string;
  stages: StageRow[];
  variant?: "card" | "embedded";
  convertToBooking?: ConvertBookingOptions | null;
}) {
  const [lostOpen, setLostOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState<"unqualified" | "disqualified" | null>(
    null,
  );
  const closeLost = currentStageKey === "closed_lost";
  const canConvert = Boolean(convertToBooking);

  return (
    <>
      <PipelineStagePath
        action={updateProspectStageAction}
        hiddenFields={{ prospectId }}
        currentStageKey={currentStageKey}
        stages={stages}
        pipeline="prospect"
        variant={variant}
        ariaLabel="Prospect stage"
        hint="Select a stage, then apply. Outcomes sit at the end of the bar."
        onSubmit={(event) => {
          const next = new FormData(event.currentTarget).get("stageKey");
          if (next === "closed_lost" && !closeLost) {
            event.preventDefault();
            setLostOpen(true);
          }
          if (next === "confirmed" && canConvert) {
            event.preventDefault();
            setConvertOpen(true);
          }
          if (
            (next === "unqualified" || next === "disqualified") &&
            next !== currentStageKey
          ) {
            event.preventDefault();
            setOutcomeOpen(next);
          }
        }}
      />
      {canConvert && currentStageKey === "confirmed" ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setConvertOpen(true)}
            className="text-sm font-semibold text-cyan-700 hover:text-cyan-900"
          >
            Convert to booking
          </button>
        </div>
      ) : null}
      {lostOpen && !closeLost ? (
        <ClosedLostPrompt
          prospectId={prospectId}
          onCancel={() => setLostOpen(false)}
        />
      ) : null}
      {convertOpen && convertToBooking ? (
        <ConvertToBookingPrompt
          prospectId={prospectId}
          directClients={convertToBooking.directClients}
          organizations={convertToBooking.organizations}
          canViewFinancials={convertToBooking.canViewFinancials}
          onCancel={() => setConvertOpen(false)}
        />
      ) : null}
      {outcomeOpen && currentStageKey !== outcomeOpen ? (
        <OutcomeReasonPrompt
          prospectId={prospectId}
          stageKey={outcomeOpen}
          title={outcomeOpen === "unqualified" ? "Mark unqualified" : "Disqualify"}
          description={
            outcomeOpen === "unqualified"
              ? "Choose why this race is unqualified."
              : "Choose why this race is disqualified."
          }
          reasons={
            outcomeOpen === "unqualified"
              ? unqualifiedReasons.map((key) => ({
                  key,
                  label: unqualifiedReasonLabels[key],
                }))
              : disqualifiedReasons.map((key) => ({
                  key,
                  label: disqualifiedReasonLabels[key],
                }))
          }
          submitLabel={outcomeOpen === "unqualified" ? "Unqualify" : "Disqualify"}
          onCancel={() => setOutcomeOpen(null)}
        />
      ) : null}
    </>
  );
}
