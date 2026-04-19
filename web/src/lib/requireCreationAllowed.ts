import type { NextRequest } from "next/server";

/** Stub for future license keys, Turnstile, billing, etc. */
export async function requireCreationAllowed(_req: NextRequest): Promise<void> {
  void _req;
}
