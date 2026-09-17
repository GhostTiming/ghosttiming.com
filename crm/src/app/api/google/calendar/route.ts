import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/db";
import { getAccessContext, requireBookingOperator } from "@/lib/auth/server";
import {
  loadCalendarLink,
  loadCalendarPayload,
  loadPendingCalendarPayloads,
} from "@/lib/crm/google-queries";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

function jsonError(error: unknown, fallback: string, status = 500) {
  rethrowNextControlFlow(error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
  const access = await getAccessContext();
  const user = access.user;
  const url = new URL(request.url);
  const bookingId = url.searchParams.get("bookingId");
  const pending = url.searchParams.get("pending") === "1";
  const connection = await getPool().query<{ calendar_id: string | null }>(
    `
      SELECT calendar_id
      FROM crm.google_connections
      WHERE user_id = $1::uuid
        AND calendar_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [user.id],
  );
  const fallbackCalendarId = connection.rows[0]?.calendar_id ?? "primary";
  if (pending) {
    if (!access.canAccessGoogle) return NextResponse.json({ items: [] });
    const organizationIds = access.isSuperAdmin ? null : access.assignedOrgIds;
    if (organizationIds && organizationIds.length === 0) {
      return NextResponse.json({ items: [] });
    }
    const items = await loadPendingCalendarPayloads(fallbackCalendarId, organizationIds);
    return NextResponse.json({ items });
  }
  if (!bookingId) {
    return NextResponse.json({ error: "bookingId is required." }, { status: 400 });
  }
  await requireBookingOperator(bookingId);
  const payload = await loadCalendarPayload(bookingId, fallbackCalendarId);
  if (!payload) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  const link = await loadCalendarLink(bookingId);
  return NextResponse.json({ ...payload, link });
  } catch (error) {
    return jsonError(error, "Calendar lookup failed.");
  }
}

export async function PUT(request: Request) {
  try {
  const body = z
    .object({
      bookingId: z.string().uuid(),
      googleSub: z.string().min(1),
      googleEmail: z.string().email(),
      googleCalendarId: z.string().min(1),
      googleEventId: z.string().min(1),
      htmlLink: z.string().nullable().optional(),
      syncStatus: z.enum(["synced", "needs_sync", "error", "deleted"]),
      lastError: z.string().nullable().optional(),
      unlink: z.boolean().optional(),
    })
    .parse(await request.json());
  const { access, user } = await requireBookingOperator(body.bookingId);
  if (!access.canAccessGoogle) {
    return NextResponse.json(
      { error: "You do not have access to Google Calendar." },
      { status: 403 },
    );
  }
  if (!body.unlink) {
    const owned = await getPool().query(
      `
        SELECT 1
        FROM crm.google_connections
        WHERE user_id = $1::uuid
          AND google_sub = $2
      `,
      [user.id, body.googleSub],
    );
    if (!owned.rows[0]) {
      return NextResponse.json(
        { error: "You can only sync Calendar for your own Google account." },
        { status: 403 },
      );
    }
  }
  if (body.unlink) {
    await getPool().query(
      `DELETE FROM crm.google_calendar_links WHERE booking_id = $1::uuid`,
      [body.bookingId],
    );
    revalidatePath(`/bookings/${body.bookingId}`);
    revalidatePath("/bookings");
    return NextResponse.json({ ok: true });
  }
  await getPool().query(
    `
      INSERT INTO crm.google_calendar_links (
        booking_id, google_sub, google_email, google_calendar_id,
        google_event_id, html_link, sync_status, last_error, last_synced_at,
        linked_at, updated_at
      )
      VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7::crm.google_calendar_sync_status, $8,
        CASE WHEN $7 = 'synced' THEN now() ELSE NULL END,
        now(), now()
      )
      ON CONFLICT (booking_id) DO UPDATE SET
        google_sub = EXCLUDED.google_sub,
        google_email = EXCLUDED.google_email,
        google_calendar_id = EXCLUDED.google_calendar_id,
        google_event_id = EXCLUDED.google_event_id,
        html_link = COALESCE(EXCLUDED.html_link, crm.google_calendar_links.html_link),
        sync_status = EXCLUDED.sync_status,
        last_error = EXCLUDED.last_error,
        last_synced_at = CASE
          WHEN EXCLUDED.sync_status = 'synced' THEN now()
          ELSE crm.google_calendar_links.last_synced_at
        END,
        updated_at = now()
    `,
    [
      body.bookingId,
      body.googleSub,
      body.googleEmail.toLowerCase(),
      body.googleCalendarId,
      body.googleEventId,
      body.htmlLink ?? null,
      body.syncStatus,
      body.lastError ?? null,
    ],
  );
  revalidatePath(`/bookings/${body.bookingId}`);
  revalidatePath("/bookings");
  return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Calendar update failed.");
  }
}
