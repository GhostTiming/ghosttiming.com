import { auth } from "@/lib/auth/neon";

export default auth.middleware({
  loginUrl: "/auth/sign-in",
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/sign-in|api/auth|api/health|api/ai).*)",
  ],
};
