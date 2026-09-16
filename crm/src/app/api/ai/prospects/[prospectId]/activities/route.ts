import { z } from "zod";
import { getPool } from "@/db";
import {
  aiUnauthorizedResponse,
  authenticateAiRequest,
} from "@/lib/auth/ai";
import { activityTypes, dispositions } from "@/lib/crm/domain";
import {
  applyTerminalDisposition,
  insertActivityAndFollowUp,
} from "@/lib/crm/mutations";

const bodySchema = z.object({
  type: z.enum(activityTypes),
  body: z.string().trim().min(1).max(10_000),
  disposition: z.enum(dispositions).optional(),
  occurred_at: z.coerce.date().optional(),
  follow_up: z
    .object({
      title: z.string().trim().min(1).max(500),
      due_at: z.coerce.date(),
      assigned_user_id: z.string().uuid().optional(),
    })
    .optional(),
});

type RouteContext = {
  params: Promise<{ prospectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const identity = authenticateAiRequest(request);
  if (!identity) return aiUnauthorizedResponse();
  const prospectId = z.string().uuid().safeParse((await context.params).prospectId);
  const body = bodySchema.safeParse(await request.json());
  if (!prospectId.success || !body.success) {
    return Response.json(
      {
        error: "Invalid activity.",
        details: body.success ? undefined : body.error.flatten(),
      },
      { status: 400 },
    );
  }

  const prospect = await getPool().query<{ assigned_user_id: string | null }>(
    `SELECT assigned_user_id::text FROM crm.prospects WHERE id = $1::uuid`,
    [prospectId.data],
  );
  if (!prospect.rows[0]) {
    return Response.json({ error: "Prospect not found." }, { status: 404 });
  }
  const taskAssignee =
    body.data.follow_up?.assigned_user_id ?? prospect.rows[0].assigned_user_id;
  if (body.data.follow_up && !taskAssignee) {
    return Response.json(
      { error: "A follow-up requires an assigned CRM user." },
      { status: 400 },
    );
  }
  if (taskAssignee) {
    const activeUser = await getPool().query(
      `SELECT 1 FROM crm.users WHERE id = $1::uuid AND is_active = true`,
      [taskAssignee],
    );
    if (!activeUser.rows[0]) {
      return Response.json(
        { error: "The follow-up assignee is not an active CRM user." },
        { status: 400 },
      );
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const created = await insertActivityAndFollowUp(client, {
      prospectId: prospectId.data,
      type: body.data.type,
      body: body.data.body,
      disposition: body.data.disposition,
      occurredAt: body.data.occurred_at,
      actorType: "ai",
      actorName: identity.actorName,
      followUp:
        body.data.follow_up && taskAssignee
          ? {
              title: body.data.follow_up.title,
              dueAt: body.data.follow_up.due_at,
              assignedUserId: taskAssignee,
            }
          : undefined,
    });
    await applyTerminalDisposition(
      client,
      prospectId.data,
      body.data.disposition,
    );
    await client.query("COMMIT");
    return Response.json(
      {
        data: {
          activity_id: created.activityId,
          task_id: created.taskId ?? null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
