import { NextResponse } from "next/server";
import { getPool } from "@/db";
import { requireCrmUser } from "@/lib/auth/server";
import {
  GOOGLE_PUBLIC_CONNECTION_SELECT,
  type GoogleConnectionRow,
} from "@/lib/crm/google-sync";
import { disconnectGoogleOfflineGrant } from "@/lib/google/google-tokens";

function rethrowNextControlFlow(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    (error.digest.startsWith("NEXT_REDIRECT") ||
      error.digest.startsWith("NEXT_NOT_FOUND"))
  ) {
    throw error;
  }
}

function jsonError(error: unknown, fallback: string) {
  rethrowNextControlFlow(error);
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const user = await requireCrmUser();
    const result = await getPool().query<GoogleConnectionRow>(
      `${GOOGLE_PUBLIC_CONNECTION_SELECT}
       WHERE user_id = $1::uuid
       ORDER BY connected_at ASC`,
      [user.id],
    );
    return NextResponse.json({
      clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
      connections: result.rows,
      connection: result.rows[0] ?? null,
    });
  } catch (error) {
    return jsonError(error, "Google connection lookup failed.");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireCrmUser();
    const body = (await request.json()) as {
      googleSub?: string;
      googleEmail?: string;
      gmailStatus?: string;
      calendarStatus?: string;
      calendarId?: string | null;
      calendarSummary?: string | null;
      gmailHistoryId?: string | null;
      gmailLastError?: string | null;
      calendarLastError?: string | null;
      gmailBackfillCompleted?: boolean;
      markGmailSynced?: boolean;
      markCalendarSynced?: boolean;
      disconnect?: boolean;
    };
    if (body.disconnect) {
      await disconnectGoogleOfflineGrant(user.id, body.googleSub ?? null);
      return NextResponse.json({ ok: true });
    }
    if (!body.googleSub || !body.googleEmail) {
      return NextResponse.json({ error: "Google account identity is required." }, { status: 400 });
    }
    await getPool().query(
      `
        INSERT INTO crm.google_connections (
          user_id, google_sub, google_email, gmail_status, calendar_status,
          calendar_id, calendar_summary, gmail_history_id, gmail_last_error,
          calendar_last_error, gmail_backfill_completed_at, gmail_last_synced_at,
          calendar_last_synced_at, connected_at, updated_at
        )
        VALUES (
          $1::uuid, $2, $3,
          COALESCE($4::crm.google_connection_status, 'connected'),
          COALESCE($5::crm.google_connection_status, 'connected'),
          $6, $7, $8, $9, $10,
          CASE WHEN $11 THEN now() ELSE NULL END,
          CASE WHEN $12 THEN now() ELSE NULL END,
          CASE WHEN $13 THEN now() ELSE NULL END,
          now(), now()
        )
        ON CONFLICT (user_id, google_sub) DO UPDATE SET
          google_sub = EXCLUDED.google_sub,
          google_email = EXCLUDED.google_email,
          gmail_status = COALESCE($4::crm.google_connection_status, crm.google_connections.gmail_status),
          calendar_status = COALESCE($5::crm.google_connection_status, crm.google_connections.calendar_status),
          calendar_id = COALESCE($6, crm.google_connections.calendar_id),
          calendar_summary = COALESCE($7, crm.google_connections.calendar_summary),
          gmail_history_id = COALESCE($8, crm.google_connections.gmail_history_id),
          gmail_last_error = CASE WHEN $14 THEN $9 ELSE crm.google_connections.gmail_last_error END,
          calendar_last_error = CASE WHEN $15 THEN $10 ELSE crm.google_connections.calendar_last_error END,
          gmail_backfill_completed_at = CASE
            WHEN $11 THEN COALESCE(crm.google_connections.gmail_backfill_completed_at, now())
            ELSE crm.google_connections.gmail_backfill_completed_at
          END,
          gmail_last_synced_at = CASE
            WHEN $12 THEN now() ELSE crm.google_connections.gmail_last_synced_at
          END,
          calendar_last_synced_at = CASE
            WHEN $13 THEN now() ELSE crm.google_connections.calendar_last_synced_at
          END,
          updated_at = now()
      `,
      [
        user.id,
        body.googleSub,
        body.googleEmail.toLowerCase(),
        body.gmailStatus ?? null,
        body.calendarStatus ?? null,
        body.calendarId ?? null,
        body.calendarSummary ?? null,
        body.gmailHistoryId ?? null,
        body.gmailLastError ?? null,
        body.calendarLastError ?? null,
        body.gmailBackfillCompleted ?? false,
        body.markGmailSynced ?? false,
        body.markCalendarSynced ?? false,
        body.gmailLastError !== undefined,
        body.calendarLastError !== undefined,
      ],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Google connection update failed.");
  }
}
