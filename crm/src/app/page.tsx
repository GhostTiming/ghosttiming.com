import { redirect } from "next/navigation";
import { requireCrmUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireCrmUser();
  redirect("/dashboard");
}
