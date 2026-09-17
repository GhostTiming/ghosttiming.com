import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireCrmUser } from "@/lib/auth/server";
import { completeGoogleOAuthLogin } from "@/lib/google/google-tokens";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  exchangeGoogleAuthorizationCode,
  googleOAuthRedirectUri,
  readOAuthStateCookie,
  safeOAuthReturnTo,
} from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

function errorRedirect(request: Request, returnTo: string, message: string) {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("google_oauth", "error");
  url.searchParams.set("google_oauth_error", message.slice(0, 180));
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let returnTo = "/dashboard";
  try {
    const user = await requireCrmUser();
    const jar = await cookies();
    const cookieValue = jar.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? null;
    const oauthError = url.searchParams.get("error");
    const state = readOAuthStateCookie(cookieValue);
    returnTo = safeOAuthReturnTo(state.returnTo);
    if (oauthError) {
      throw new Error(url.searchParams.get("error_description") || oauthError);
    }
    if (url.searchParams.get("state") !== state.state) {
      throw new Error("Google sign-in could not be verified. Try Connect Google again.");
    }
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google did not return an authorization code.");
    const tokens = await exchangeGoogleAuthorizationCode({
      code,
      verifier: state.verifier,
      redirectUri: googleOAuthRedirectUri(request),
    });
    await completeGoogleOAuthLogin({ userId: user.id, tokens });
    const destination = new URL(returnTo, request.url);
    destination.searchParams.delete("google_oauth");
    destination.searchParams.delete("google_oauth_error");
    destination.searchParams.set("google_oauth", "connected");
    const response = NextResponse.redirect(destination);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed.";
    const response = errorRedirect(request, returnTo, message);
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }
}
