import { createHash, timingSafeEqual } from "node:crypto";

export type AiIdentity = {
  actorType: "ai";
  actorName: string;
};

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function authenticateAiRequest(request: Request): AiIdentity | null {
  const expectedKey = process.env.CRM_AI_API_KEY;
  if (!expectedKey || expectedKey.length < 32) return null;

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  if (!timingSafeEqual(digest(match[1]), digest(expectedKey))) return null;
  return {
    actorType: "ai",
    actorName: process.env.CRM_AI_ACTOR_NAME?.trim() || "Claude",
  };
}

export function aiUnauthorizedResponse() {
  return Response.json(
    { error: "A valid AI bearer token is required." },
    {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    },
  );
}
