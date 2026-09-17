"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateProspectStageAction } from "@/app/prospect-actions";
import { ClosedLostPrompt } from "@/components/prospecting/closed-lost-prompt";
import { OutcomeReasonPrompt } from "@/components/prospecting/outcome-reason-prompt";
import {
  disqualifiedReasonLabels,
  disqualifiedReasons,
  prospectListOutcomeStages,
  unqualifiedReasonLabels,
  unqualifiedReasons,
} from "@/lib/crm/domain";
import { rethrowIfNextControlFlow } from "@/lib/next-control-flow";

function bubbleClass(active: boolean) {
  return `rounded-md px-2 py-1 text-xs font-semibold leading-tight ring-1 ${
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
  const [outcomeOpen, setOutcomeOpen] = useState<"unqualified" | "disqualified" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const alreadyLost = currentStageKey === "closed_lost";

  async function submit(formData: FormData) {
    setError(null);
    try {
      await updateProspectStageAction(formData);
    } catch (cause) {
      rethrowIfNextControlFlow(cause);
      setError(cause instanceof Error ? cause.message : "Could not save stage.");
    }
  }

  function onOutcomeSelect(value: string) {
    if (!value || value === currentStageKey) return;
    if (value === "closed_lost") {
      setLostOpen(true);
      return;
    }
    if (value === "unqualified" || value === "disqualified") {
      setOutcomeOpen(value);
      return;
    }
    const formData = new FormData();
    formData.set("prospectId", prospectId);
    formData.set("stageKey", value);
    void submit(formData);
  }

  return (
    <>
      <div
        className="relative z-10 md:hidden"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Outcome
          </span>
          <select
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
            aria-label="Mark prospect outcome"
            value=""
            onChange={(event) => {
              onOutcomeSelect(event.target.value);
              event.currentTarget.value = "";
            }}
          >
            <option value="">Choose outcome…</option>
            {prospectListOutcomeStages.map((stage) => (
              <option
                key={stage.key}
                value={stage.key}
                disabled={currentStageKey === stage.key}
              >
                {stage.label}
                {currentStageKey === stage.key ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form
        action={submit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className="relative z-10 hidden flex-wrap justify-end gap-1 md:flex"
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
          ) : stage.key === "unqualified" || stage.key === "disqualified" ? (
            <button
              key={stage.key}
              type="button"
              disabled={currentStageKey === stage.key}
              title={
                currentStageKey === stage.key
                  ? `Already ${stage.label.toLowerCase()}`
                  : stage.label
              }
              className={bubbleClass(currentStageKey === stage.key)}
              onClick={() => setOutcomeOpen(stage.key)}
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
