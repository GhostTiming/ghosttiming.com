import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdminConsole } from "@/lib/auth/server";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";
import { saveRunSignupAccount } from "@/lib/runsignup/accounts";
import {
  RUNSIGNUP_OAUTH_STATE_COOKIE,
  exchangeRunSignupAuthorizationCode,
  readRunSignupOAuthState,
  runSignupOAuthRedirectUri,
} from "@/lib/runsignup/oauth";

export const dynamic = "force-dynamic";

function clearStateCookie(response: NextResponse) {
  response.cookies.set(RUNSIGNUP_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function errorRedirect(request: Request, returnTo: string, message: string) {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("runsignup_oauth", "error");
  url.searchParams.set("runsignup_oauth_error", message.slice(0, 180));
  return clearStateCookie(NextResponse.redirect(url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let returnTo = "/settings";
  try {
    const access = await requireAdminConsole();
    const jar = await cookies();
    const state = readRunSignupOAuthState(jar.get(RUNSIGNUP_OAUTH_STATE_COOKIE)?.value ?? null);
    returnTo = state.returnTo;
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      throw new Error(url.searchParams.get("error_description") || "RunSignUp sign-in was canceled.");
    }
    if (url.searchParams.get("state") !== state.state) {
      throw new Error("RunSignUp sign-in could not be verified. Try Connect RunSignUp again.");
    }
    const code = url.searchParams.get("code");
    if (!code) throw new Error("RunSignUp did not return an authorization code.");
    const tokens = await exchangeRunSignupAuthorizationCode({
      code,
      verifier: state.verifier,
      redirectUri: runSignupOAuthRedirectUri(request),
    });
    await saveRunSignupAccount({
      connectedByUserId: access.user.id,
      tokens,
    });
    const destination = new URL(returnTo, request.url);
    destination.searchParams.set("runsignup_oauth", "connected");
    return clearStateCookie(NextResponse.redirect(destination));
  } catch (error) {
    rethrowNextControlFlow(error);
    const message = error instanceof Error ? error.message : "RunSignUp sign-in failed.";
    return errorRedirect(request, returnTo, message);
  }
}
