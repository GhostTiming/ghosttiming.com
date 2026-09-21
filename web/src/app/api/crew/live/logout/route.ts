import { NextResponse } from "next/server";
import { CREW_COOKIE, crewCookieOptions } from "@/lib/crew-session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CREW_COOKIE, "", {
    ...crewCookieOptions,
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
