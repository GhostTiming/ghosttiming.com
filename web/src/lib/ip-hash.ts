import { createHash } from "crypto";

export function hashIpForRateLimit(ip: string | null, secret: string): string {
  const raw = (ip || "unknown").trim();
  return createHash("sha256").update(`${secret}:${raw}`).digest("hex").slice(0, 32);
}
