import { NextRequest } from "next/server";
import { z } from "zod";
import {
  aiUnauthorizedResponse,
  authenticateAiRequest,
} from "@/lib/auth/ai";
import { listAiProspects } from "@/lib/crm/ai-queries";

const querySchema = z.object({
  stage: z.string().trim().min(1).max(80).optional(),
  untouched: z.enum(["true", "false"]).optional(),
  include_closed: z.enum(["true", "false"]).optional(),
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: NextRequest) {
  if (!authenticateAiRequest(request)) return aiUnauthorizedResponse();
  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query parameters.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await listAiProspects({
    stage: parsed.data.stage,
    untouched:
      parsed.data.untouched === undefined
        ? undefined
        : parsed.data.untouched === "true",
    includeClosed: parsed.data.include_closed === "true",
    after: parsed.data.after,
    limit: parsed.data.limit,
  });
  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
