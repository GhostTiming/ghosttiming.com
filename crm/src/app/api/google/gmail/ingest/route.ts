import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/db";
import { getAccessContext } from "@/lib/auth/server";
import { ingestGmailMessages } from "@/lib/crm/google-sync";

const messageSchema = z.object({
  gmailMessageId: z.string().min(1),
  gmailThreadId: z.string().nullable(),
  rfcMessageId: z.string().nullable(),
  direction: z.enum(["incoming", "outgoing"]),
  fromAddress: z.string().nullable(),
  fromName: z.string().nullable(),
  toAddresses: z.array(z.string()),
  ccAddresses: z.array(z.string()),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  bodyText: z.string().nullable(),
  occurredAt: z.string().min(1),
  involvedEmails: z.array(z.string()).optional().default([]),
  prospectIds: z.array(z.string().uuid()).optional().default([]),
  bookingIds: z.array(z.string().uuid()).optional().default([]),
  organizationIds: z.array(z.string().uuid()).optional().default([]),
  personIds: z.array(z.string().uuid()).optional().default([]),
});

export async function POST(request: Request) {
  const access = await getAccessContext();
  const user = access.user;
  const body = z
    .object({
      googleSub: z.string().min(1),
      googleEmail: z.string().email(),
      messages: z.array(messageSchema).max(50),
    })
    .parse(await request.json());
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
    return NextResponse.json(
      { error: "That Gmail account is not connected to your CRM user." },
      { status: 403 },
    );
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await ingestGmailMessages(client, {
      googleSub: body.googleSub,
      googleEmail: body.googleEmail.toLowerCase(),
      actorUserId: user.id,
      organizationIds: access.isSuperAdmin ? null : access.assignedOrgIds,
      messages: body.messages,
    });
    await client.query("COMMIT");
    revalidatePath("/prospecting");
    revalidatePath("/bookings");
    revalidatePath("/organizations");
    return NextResponse.json(result);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
