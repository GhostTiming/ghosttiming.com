import { NextResponse } from "next/server";
import { requireAdminConsole } from "@/lib/auth/server";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";
import { safeOAuthReturnTo } from "@/lib/google/oauth";
import {
  RUNSIGNUP_OAUTH_STATE_COOKIE,
  RUNSIGNUP_OAUTH_STATE_MAX_AGE_SECONDS,
  buildRunSignupAuthorizeRedirect,
} from "@/lib/runsignup/oauth";

export const dynamic = "force-dynamic";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RUNSIGNUP_OAUTH_STATE_MAX_AGE_SECONDS,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeOAuthReturnTo(url.searchParams.get("returnTo") ?? "/settings");
  try {
    await requireAdminConsole();
    const started = buildRunSignupAuthorizeRedirect({ request, returnTo });
    const response = NextResponse.redirect(started.authorizeUrl);
    response.cookies.set(RUNSIGNUP_OAUTH_STATE_COOKIE, started.cookieValue, cookieOptions());
    return response;
  } catch (error) {
    rethrowNextControlFlow(error);
    const message = error instanceof Error ? error.message : "RunSignUp sign-in could not start.";
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("runsignup_oauth", "error");
    destination.searchParams.set("runsignup_oauth_error", message.slice(0, 180));
    return NextResponse.redirect(destination);
  }
}
