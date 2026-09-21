import { NextResponse } from "next/server";
import {
  secretsConfigured,
  verifyCrewPassword,
} from "@/lib/crew-auth";
import { CREW_COOKIE, crewCookieOptions, signCrewSession } from "@/lib/crew-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!secretsConfigured().password) {
    return NextResponse.json(
      { error: "Crew live password is not configured." },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const password = String(body.password ?? "");
  if (!verifyCrewPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const token = await signCrewSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CREW_COOKIE, token, {
    ...crewCookieOptions,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
