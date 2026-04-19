import { SignJWT, jwtVerify } from "jose";

const COOKIE_PREFIX = "cs_e_";

export function viewerCookieName(shortId: string): string {
  return `${COOKIE_PREFIX}${shortId}`;
}

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 chars)");
  }
  return new TextEncoder().encode(s);
}

export type ViewerSessionPayload = {
  eid: string;
  sid: string;
};

export async function signViewerSession(
  payload: ViewerSessionPayload,
  maxAgeSec = 60 * 60 * 24 * 7,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(getSecret());
}

export async function verifyViewerSession(
  token: string | undefined,
): Promise<ViewerSessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const eid = typeof payload.eid === "string" ? payload.eid : "";
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    if (!eid || !sid) return null;
    return { eid, sid };
  } catch {
    return null;
  }
}
