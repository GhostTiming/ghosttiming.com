"use client";

import { useState } from "react";
import { changeBookingStageAction } from "@/app/booking-actions";
import {
  BookingPrepPrompt,
  type BookingPrepItem,
} from "@/components/booking-prep-prompt";
import {
  PipelineStagePath,
  type PipelineStageOption,
} from "@/components/pipeline-stage-path";
import { ClosedLostPrompt } from "@/components/prospecting/closed-lost-prompt";

export function BookingStagePath({
  bookingId,
  currentStageKey,
  stages,
  prepItems,
}: {
  bookingId: string;
  currentStageKey: string;
  stages: readonly PipelineStageOption[];
  prepItems: readonly BookingPrepItem[];
}) {
  const [prepOpen, setPrepOpen] = useState<"ready" | "prep" | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const alreadyReady = currentStageKey === "ready";
  const alreadyLost = currentStageKey === "closed_lost";
  const canLogPrep = currentStageKey !== "closed_lost";

  return (
    <>
      <PipelineStagePath
        action={changeBookingStageAction}
        hiddenFields={{ bookingId }}
        currentStageKey={currentStageKey}
        stages={stages}
        pipeline="booking"
        ariaLabel="Booking stage"
        hint="Select a stage, then apply. Closed Lost sits at the end of the bar."
        onSubmit={(event) => {
          const next = new FormData(event.currentTarget).get("stageKey");
          if (next === "ready" && !alreadyReady) {
            event.preventDefault();
            setPrepOpen("ready");
          }
          if (next === "closed_lost" && !alreadyLost) {
            event.preventDefault();
            setLostOpen(true);
          }
        }}
      />
      {canLogPrep ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setPrepOpen("prep")}
            className="text-sm font-semibold text-cyan-700 hover:text-cyan-900"
          >
            Log pre-event prep
          </button>
        </div>
      ) : null}
      {prepOpen ? (
        <BookingPrepPrompt
          bookingId={bookingId}
          items={prepItems}
          markReady={prepOpen === "ready"}
          onCancel={() => setPrepOpen(null)}
        />
      ) : null}
      {lostOpen && !alreadyLost ? (
        <ClosedLostPrompt
          bookingId={bookingId}
          onCancel={() => setLostOpen(false)}
        />
      ) : null}
    </>
  );
}
