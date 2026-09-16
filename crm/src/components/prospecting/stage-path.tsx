"use client";

import { useState } from "react";
import { updateProspectStageAction } from "@/app/prospect-actions";
import { PipelineStagePath } from "@/components/pipeline-stage-path";
import { ClosedLostPrompt } from "@/components/prospecting/closed-lost-prompt";
import type { StageRow } from "@/lib/crm/queries";

export function ProspectStagePath({
  prospectId,
  currentStageKey,
  stages,
}: {
  prospectId: string;
  currentStageKey: string;
  stages: StageRow[];
}) {
  const [lostOpen, setLostOpen] = useState(false);
  const closeLost = currentStageKey === "closed_lost";

  return (
    <>
      <PipelineStagePath
        action={updateProspectStageAction}
        hiddenFields={{ prospectId }}
        currentStageKey={currentStageKey}
        stages={stages}
        pipeline="prospect"
        ariaLabel="Prospect stage"
        hint="Select a stage, then apply. Outcomes sit at the end of the bar."
        onSubmit={(event) => {
          const next = new FormData(event.currentTarget).get("stageKey");
          if (next === "closed_lost" && !closeLost) {
            event.preventDefault();
            setLostOpen(true);
          }
        }}
      />
      {lostOpen && !closeLost ? (
        <ClosedLostPrompt
          prospectId={prospectId}
          onCancel={() => setLostOpen(false)}
        />
      ) : null}
    </>
  );
}
