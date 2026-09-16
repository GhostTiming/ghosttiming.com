import { getPool } from "@/db";
import {
  aiUnauthorizedResponse,
  authenticateAiRequest,
} from "@/lib/auth/ai";

export async function GET(request: Request) {
  if (!authenticateAiRequest(request)) return aiUnauthorizedResponse();
  const users = await getPool().query(
    `
      SELECT id::text, name, email, role::text
      FROM crm.users
      WHERE is_active = true
      ORDER BY name
    `,
  );
  return Response.json(
    { data: users.rows },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
