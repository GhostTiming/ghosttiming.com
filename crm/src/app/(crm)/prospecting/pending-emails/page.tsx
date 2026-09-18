import { PendingEmailsReview } from "@/components/cadence/pending-emails-review";
import { requireProspectingAccess } from "@/lib/auth/server";
import {
  listPendingCadenceSends,
  processCadenceReplies,
} from "@/lib/crm/cadence";

export const metadata = { title: "Pending cadence emails" };

export default async function PendingCadenceEmailsPage() {
  const access = await requireProspectingAccess();
  try {
    await processCadenceReplies();
  } catch {
    // Tables may not exist until 0030 is applied.
  }
  const rows = await listPendingCadenceSends({
    userId: access.user.id,
    includeUnassigned: access.isSuperAdmin,
  }).catch(() => [] as Awaited<ReturnType<typeof listPendingCadenceSends>>);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
          Cadence
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Pending emails
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Due touches wait here until you approve or decline them. Declining
          removes the lead from the cadence and does not change pipeline stage.
        </p>
      </div>
      <PendingEmailsReview rows={rows} />
    </div>
  );
}
