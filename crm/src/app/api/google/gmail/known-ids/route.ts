import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/db";
import { requireCrmUser } from "@/lib/auth/server";

export async function POST(request: Request) {
  const user = await requireCrmUser();
  const body = z
    .object({
      googleSub: z.string().min(1),
      ids: z.array(z.string().min(1)).max(500),
    })
    .parse(await request.json());
  if (!body.ids.length) return NextResponse.json({ ids: [] as string[] });
  const owned = await getPool().query<{ google_sub: string }>(
    `
      SELECT google_sub
      FROM crm.google_connections
      WHERE user_id = $1::uuid AND google_sub = $2
      LIMIT 1
    `,
    [user.id, body.googleSub],
  );
  if (!owned.rows[0]) {
    return NextResponse.json({ ids: [] as string[] });
  }
  const result = await getPool().query<{ gmail_message_id: string }>(
    `
      SELECT gmail_message_id
      FROM crm.google_email_messages
      WHERE google_sub = $1
        AND gmail_message_id = ANY($2::text[])
    `,
    [body.googleSub, body.ids],
  );
  return NextResponse.json({ ids: result.rows.map((row) => row.gmail_message_id) });
}
