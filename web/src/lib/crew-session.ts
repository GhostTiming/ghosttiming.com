import { SignJWT, jwtVerify } from "jose";

export const CREW_COOKIE = "cs_crew";
const CREW_MAX_AGE_SEC = 60 * 60 * 12;

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 chars)");
  }
  return new TextEncoder().encode(s);
}

export type CrewSessionPayload = {
  role: "crew";
};

export async function signCrewSession(
  maxAgeSec = CREW_MAX_AGE_SEC,
): Promise<string> {
  return new SignJWT({ role: "crew" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(getSecret());
}

export async function verifyCrewSession(
  token: string | undefined,
): Promise<CrewSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.role !== "crew") return null;
    return { role: "crew" };
  } catch {
    return null;
  }
}

export const crewCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: CREW_MAX_AGE_SEC,
};
