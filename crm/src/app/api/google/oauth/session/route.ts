import { NextResponse } from "next/server";
import { requireCrmUser } from "@/lib/auth/server";
import {
  GoogleNeedsReauthError,
  getGoogleSessionToken,
} from "@/lib/google/google-tokens";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCrmUser();
    const googleSub = new URL(request.url).searchParams.get("googleSub");
    const session = await getGoogleSessionToken(user.id, googleSub);
    return NextResponse.json(
      {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        googleSub: session.googleSub,
        googleEmail: session.googleEmail,
        scope: session.scope,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof GoogleNeedsReauthError) {
      return NextResponse.json(
        { error: error.message, needsReauth: true },
        { status: 409, headers: { "Cache-Control": "no-store, private" } },
      );
    }
    const message = error instanceof Error ? error.message : "Google session lookup failed.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}
