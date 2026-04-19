import { EventDashboard } from "@/components/dashboard/EventDashboard";

export const dynamic = "force-dynamic";

export default function EventViewerPage({
  params,
}: {
  params: { shortId: string };
}) {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <EventDashboard shortId={params.shortId} />
    </div>
  );
}
