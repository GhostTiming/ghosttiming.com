import { formatCalendarDate } from "@/lib/crm/domain";
import {
  cadenceStepLabel,
  type CadenceEnrollmentSummary,
  type CadenceRow,
} from "@/lib/crm/cadence-copy";
import { enrollProspectInCadenceAction } from "@/app/cadence-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";

function statusLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "completed") return "Completed";
  if (status === "exited_reply") return "Stopped after a reply";
  if (status === "exited_manual") return "Stopped";
  return status;
}

export function CadencePanel({
  prospectId,
  cadence,
  enrollment,
  canEnroll,
  error,
}: {
  prospectId: string;
  cadence: CadenceRow | null;
  enrollment: CadenceEnrollmentSummary | null;
  canEnroll: boolean;
  error?: string | null;
}) {
  const active = enrollment?.status === "active";
  const showStart = canEnroll && cadence && !active;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Cadence
      </h2>
      {error ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {error}
        </p>
      ) : null}
      {enrollment ? (
        <div className="mt-3 space-y-1 text-sm">
          <p className="font-semibold text-slate-950">{enrollment.cadence_name}</p>
          <p className="text-slate-600">{statusLabel(enrollment.status)}</p>
          {active && enrollment.next_step_order ? (
            <p className="text-slate-600">
              Next: {cadenceStepLabel(enrollment.next_step_order, enrollment.step_count)}
              {enrollment.next_scheduled_for
                ? ` on ${formatCalendarDate(enrollment.next_scheduled_for.slice(0, 10)) ?? enrollment.next_scheduled_for}`
                : ""}
            </p>
          ) : null}
          {enrollment.current_step_order ? (
            <p className="text-slate-500">
              Last sent: {cadenceStepLabel(enrollment.current_step_order, enrollment.step_count)}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          {cadence
            ? `${cadence.name} can send the intro immediately, then bump, tip, and close on days 5, 10, and 24.`
            : "No active cadence is set up yet."}
        </p>
      )}
      {showStart ? (
        <form action={enrollProspectInCadenceAction} className="mt-4">
          <input type="hidden" name="prospectId" value={prospectId} />
          <input type="hidden" name="cadenceId" value={cadence.id} />
          <PendingSubmitButton
            pendingLabel="Starting…"
            savedLabel="Started"
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {enrollment ? "Re-enroll in cadence" : "Start cadence"}
          </PendingSubmitButton>
        </form>
      ) : null}
    </section>
  );
}
