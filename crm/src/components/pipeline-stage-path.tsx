"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";
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

export type PipelineStageActionResult = {
  ok?: boolean;
  message?: string;
} | void;

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
  variant = "card",
  onSubmit,
}: {
  action: (
    formData: FormData,
  ) => PipelineStageActionResult | Promise<PipelineStageActionResult>;
  hiddenFields: Record<string, string>;
  currentStageKey: string;
  stages: readonly PipelineStageOption[];
  pipeline: PipelineKind;
  label?: ReactNode;
  hint?: string;
  ariaLabel?: string;
  variant?: "card" | "embedded";
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    try {
      const result = await action(formData);
      if (result && result.ok === false) {
        setSaveFailed(true);
        setError(result.message ?? "Could not save stage.");
        return;
      }
      router.refresh();
    } catch (cause) {
      rethrowNextControlFlow(cause);
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
      className={
        variant === "embedded"
          ? "mt-5 border-t border-slate-200 pt-4"
          : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      }
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
        className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 sm:flex sm:overflow-x-auto"
        role="radiogroup"
        aria-label={ariaLabel}
      >
        {stages.map((stage, index) => (
          <label
            key={stage.key}
            className={`relative flex min-h-12 min-w-0 cursor-pointer hover:bg-slate-50 sm:min-w-[4.75rem] sm:flex-1 ${
              index % 2 === 1 ? "border-l border-slate-200" : ""
            } ${index >= 2 ? "border-t border-slate-200" : ""} ${
              index > 0 ? "sm:border-l sm:border-t-0" : "sm:border-l-0 sm:border-t-0"
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
