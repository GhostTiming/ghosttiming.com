"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateProspectStageAction } from "@/app/prospect-actions";
import { ClosedLostPrompt } from "@/components/prospecting/closed-lost-prompt";
import { prospectListOutcomeStages } from "@/lib/crm/domain";

function bubbleClass(active: boolean) {
  return `rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight ring-1 ${
    active
      ? "bg-slate-900 text-white ring-slate-900"
      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"
  } disabled:cursor-default disabled:opacity-60`;
}

function StageBubble({
  stageKey,
  label,
  currentStageKey,
}: {
  stageKey: string;
  label: string;
  currentStageKey: string;
}) {
  const { pending } = useFormStatus();
  const active = currentStageKey === stageKey;
  return (
    <button
      type="submit"
      name="stageKey"
      value={stageKey}
      disabled={pending || active}
      title={pending ? "Saving…" : active ? `Already ${label.toLowerCase()}` : label}
      aria-busy={pending}
      className={bubbleClass(active)}
    >
      {label}
    </button>
  );
}

export function ProspectListStageBubbles({
  prospectId,
  currentStageKey,
}: {
  prospectId: string;
  currentStageKey: string;
}) {
  const [lostOpen, setLostOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadyLost = currentStageKey === "closed_lost";

  async function submit(formData: FormData) {
    setError(null);
    try {
      await updateProspectStageAction(formData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save stage.");
    }
  }

  return (
    <>
      <form
        action={submit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className="relative z-10 flex flex-wrap justify-end gap-1"
        aria-label="Mark prospect outcome"
      >
        <input type="hidden" name="prospectId" value={prospectId} />
        {prospectListOutcomeStages.map((stage) =>
          stage.key === "closed_lost" ? (
            <button
              key={stage.key}
              type="button"
              disabled={alreadyLost}
              title={alreadyLost ? "Already close lost" : stage.label}
              className={bubbleClass(alreadyLost)}
              onClick={() => setLostOpen(true)}
            >
              {stage.label}
            </button>
          ) : (
            <StageBubble
              key={stage.key}
              stageKey={stage.key}
              label={stage.label}
              currentStageKey={currentStageKey}
            />
          ),
        )}
      </form>
      {error ? (
        <p className="mt-1 text-right text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {lostOpen && !alreadyLost ? (
        <ClosedLostPrompt
          prospectId={prospectId}
          onCancel={() => setLostOpen(false)}
        />
      ) : null}
    </>
  );
}
