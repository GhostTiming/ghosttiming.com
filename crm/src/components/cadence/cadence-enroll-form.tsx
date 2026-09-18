"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { enrollProspectInCadenceAction } from "@/app/cadence-actions";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";

type EnrollState = { ok: boolean; message: string } | null;

export function CadenceEnrollForm({
  prospectId,
  cadenceId,
  label,
}: {
  prospectId: string;
  cadenceId: string;
  label: string;
}) {
  const router = useRouter();
  const [state, action] = useActionState(enrollProspectInCadenceAction, null as EnrollState);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <FormSaveFailedContext.Provider value={Boolean(state && !state.ok)}>
      <form action={action} className="mt-4">
        <input type="hidden" name="prospectId" value={prospectId} />
        <input type="hidden" name="cadenceId" value={cadenceId} />
        {state?.message ? (
          <p
            className={
              state.ok
                ? "mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
                : "mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            }
          >
            {state.message}
          </p>
        ) : null}
        <PendingSubmitButton
          pendingLabel="Starting…"
          savedLabel="Started"
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {label}
        </PendingSubmitButton>
      </form>
    </FormSaveFailedContext.Provider>
  );
}
