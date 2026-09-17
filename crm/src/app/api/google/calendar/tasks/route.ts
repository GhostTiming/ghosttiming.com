import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/db";
import { loadTaskCalendarPayload } from "@/lib/crm/google-queries";
import { requireTaskOperator } from "@/lib/crm/task-access";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

function jsonError(error: unknown, fallback: string, status = 500) {
  rethrowNextControlFlow(error);
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? fallback },
      { status: 400 },
    );
  }
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

function refreshTaskPaths(task: {
  prospect_id: string | null;
  booking_id: string | null;
  organization_id: string | null;
}) {
  revalidatePath("/tasks");
  if (task.prospect_id) revalidatePath(`/prospecting/${task.prospect_id}`);
  if (task.booking_id) revalidatePath(`/bookings/${task.booking_id}`);
  if (task.organization_id) revalidatePath(`/organizations/${task.organization_id}`);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = z.string().uuid().parse(url.searchParams.get("taskId"));
    const { access, user, task } = await requireTaskOperator(taskId);
    if (!access.canAccessGoogle) {
      return NextResponse.json(
        { error: "You do not have access to Google Calendar." },
        { status: 403 },
      );
    }
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
    const payload = await loadTaskCalendarPayload(
      task.id,
      connection.rows[0]?.calendar_id ?? "primary",
    );
    if (!payload) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    return NextResponse.json(payload);
  } catch (error) {
    return jsonError(error, "Task calendar lookup failed.");
  }
}

export async function PUT(request: Request) {
  try {
    const body = z
      .object({
        taskId: z.string().uuid(),
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
    const { access, user, task } = await requireTaskOperator(body.taskId);
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
        `DELETE FROM crm.google_task_calendar_links WHERE task_id = $1::uuid`,
        [body.taskId],
      );
      refreshTaskPaths(task);
      return NextResponse.json({ ok: true });
    }
    await getPool().query(
      `
        INSERT INTO crm.google_task_calendar_links (
          task_id, google_sub, google_email, google_calendar_id,
          google_event_id, html_link, sync_status, last_error, last_synced_at,
          linked_at, updated_at
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7::crm.google_calendar_sync_status, $8,
          CASE WHEN $7 = 'synced' THEN now() ELSE NULL END,
          now(), now()
        )
        ON CONFLICT (task_id) DO UPDATE SET
          google_sub = EXCLUDED.google_sub,
          google_email = EXCLUDED.google_email,
          google_calendar_id = EXCLUDED.google_calendar_id,
          google_event_id = EXCLUDED.google_event_id,
          html_link = COALESCE(EXCLUDED.html_link, crm.google_task_calendar_links.html_link),
          sync_status = EXCLUDED.sync_status,
          last_error = EXCLUDED.last_error,
          last_synced_at = CASE
            WHEN EXCLUDED.sync_status = 'synced' THEN now()
            ELSE crm.google_task_calendar_links.last_synced_at
          END,
          updated_at = now()
      `,
      [
        body.taskId,
        body.googleSub,
        body.googleEmail.toLowerCase(),
        body.googleCalendarId,
        body.googleEventId,
        body.htmlLink ?? null,
        body.syncStatus,
        body.lastError ?? null,
      ],
    );
    refreshTaskPaths(task);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Task calendar update failed.");
  }
}
