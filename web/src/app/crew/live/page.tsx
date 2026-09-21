import { redirect } from "next/navigation";
import { CrewLiveView } from "@/components/crew/CrewLiveView";
import { requireCrewCookie } from "@/lib/crew-auth";

export const dynamic = "force-dynamic";

export default async function CrewLivePage() {
  if (!(await requireCrewCookie())) {
    redirect("/crew/live/login");
  }
  return <CrewLiveView />;
}
