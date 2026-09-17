import { NextResponse } from "next/server";
import { requireCrmUser } from "@/lib/auth/server";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  assertGoogleOAuthServerConfig,
  buildGoogleAuthorizeRedirect,
  safeOAuthReturnTo,
} from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeOAuthReturnTo(url.searchParams.get("returnTo"));
  try {
    const user = await requireCrmUser();
    assertGoogleOAuthServerConfig();
    const addAccount = url.searchParams.get("addAccount") === "1";
    const started = buildGoogleAuthorizeRedirect({
      request,
      returnTo,
      addAccount,
      loginHint: addAccount ? null : url.searchParams.get("loginHint"),
    });
    const response = NextResponse.redirect(started.authorizeUrl);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, started.cookieValue, cookieOptions());
    void user;
    return response;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Google sign-in could not start.";
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("google_oauth", "error");
    destination.searchParams.set("google_oauth_error", message.slice(0, 180));
    return NextResponse.redirect(destination);
  }
}
