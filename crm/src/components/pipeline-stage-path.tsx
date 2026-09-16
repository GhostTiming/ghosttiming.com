"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import {
  bookingStageTone,
  prospectStageTone,
  type PipelineStageTone,
} from "@/lib/crm/domain";

export type PipelineStageOption = {
  key: string;
  name: string;
};

export type PipelineKind = "booking" | "prospect";

const toneClass: Record<PipelineStageTone, string> = {
  live: "peer-checked:bg-cyan-700",
  won: "peer-checked:bg-emerald-700",
  lost: "peer-checked:bg-slate-800",
};

function stageTone(pipeline: PipelineKind, stageKey: string): PipelineStageTone {
  return pipeline === "booking"
    ? bookingStageTone(stageKey)
    : prospectStageTone(stageKey);
}

export function PipelineStagePath({
  action,
  hiddenFields,
  currentStageKey,
  stages,
  pipeline,
  label = "Pipeline stage",
  hint = "Select a stage, then apply.",
  ariaLabel = "Pipeline stage",
  onSubmit,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  currentStageKey: string;
  stages: readonly PipelineStageOption[];
  pipeline: PipelineKind;
  label?: ReactNode;
  hint?: string;
  ariaLabel?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      await action(formData);
    } catch (cause) {
      setSaveFailed(true);
      setError(cause instanceof Error ? cause.message : "Could not save stage.");
    }
  }

  return (
    <FormSaveFailedContext.Provider value={saveFailed}>
    <form
      key={currentStageKey}
      action={submit}
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{hint}</p>
        </div>
        <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60">
          Apply stage
        </PendingSubmitButton>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className="mt-4 flex overflow-x-auto rounded-xl border border-slate-200"
        role="radiogroup"
        aria-label={ariaLabel}
      >
        {stages.map((stage, index) => (
          <label
            key={stage.key}
            className={`relative flex min-w-[4.75rem] flex-1 cursor-pointer hover:bg-slate-50 ${
              index > 0 ? "border-l border-slate-200" : ""
            }`}
          >
            <input
              type="radio"
              name="stageKey"
              value={stage.key}
              defaultChecked={stage.key === currentStageKey}
              className="peer sr-only"
            />
            <span
              className={`pointer-events-none flex min-h-12 w-full items-center justify-center px-2 py-2 text-center text-xs font-semibold leading-tight text-slate-600 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-600 peer-checked:text-white ${toneClass[stageTone(pipeline, stage.key)]}`}
            >
              {stage.name}
            </span>
          </label>
        ))}
      </div>
    </form>
    </FormSaveFailedContext.Provider>
  );
}
