import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Serve the legacy marketing homepage from `public/ghost-home.html` at `/`. */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/ghost-home.html", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
