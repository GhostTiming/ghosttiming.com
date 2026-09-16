import { z } from "zod";
import { getPool } from "@/db";
import {
  aiUnauthorizedResponse,
  authenticateAiRequest,
} from "@/lib/auth/ai";
import { getAiProspect } from "@/lib/crm/ai-queries";
import { parseClosedLostDetails } from "@/lib/crm/domain";
import { changeProspectStage } from "@/lib/crm/mutations";

const prospectIdSchema = z.string().uuid();
const updateSchema = z
  .object({
    stage: z
      .enum(["cold", "contacting", "interested", "scoping", "confirmed", "closed_lost", "disqualified", "unqualified", "past_event"])
      .optional(),
    assigned_owner_id: z.string().uuid().nullable().optional(),
    closed_lost_reason: z
      .enum(["went_with_another_timer", "event_cancelled", "no_decision", "other"])
      .optional(),
    closed_lost_note: z.string().trim().max(5_000).optional(),
    circle_back_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    unqualified_reason: z.enum(["event_too_soon", "other"]).optional(),
    unqualified_note: z.string().trim().max(5_000).optional(),
    disqualified_reason: z.enum(["is_a_timing_company", "other"]).optional(),
    disqualified_note: z.string().trim().max(5_000).optional(),
  })
  .refine(
    (value) =>
      value.stage !== undefined || value.assigned_owner_id !== undefined,
    "At least one update field is required.",
  );

type RouteContext = {
  params: Promise<{ prospectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  if (!authenticateAiRequest(request)) return aiUnauthorizedResponse();
  const parsedId = prospectIdSchema.safeParse((await context.params).prospectId);
  if (!parsedId.success) {
    return Response.json({ error: "Invalid prospect ID." }, { status: 400 });
  }
  const prospect = await getAiProspect(parsedId.data);
  if (!prospect) {
    return Response.json({ error: "Prospect not found." }, { status: 404 });
  }
  return Response.json(
    { data: prospect },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const identity = authenticateAiRequest(request);
  if (!identity) return aiUnauthorizedResponse();
  const parsedId = prospectIdSchema.safeParse((await context.params).prospectId);
  const parsedBody = updateSchema.safeParse(await request.json());
  if (!parsedId.success || !parsedBody.success) {
    return Response.json(
      {
        error: "Invalid prospect update.",
        details: parsedBody.success ? undefined : parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }
  const existing = await getAiProspect(parsedId.data);
  if (!existing) {
    return Response.json({ error: "Prospect not found." }, { status: 404 });
  }

  const stageKey =
    parsedBody.data.stage === "contacting" ||
    parsedBody.data.stage === "interested"
      ? "cold"
      : parsedBody.data.stage;
  let closedLost = null;
  if (stageKey === "closed_lost" && existing.stage !== "closed_lost") {
    try {
      closedLost = parseClosedLostDetails({
        reason: parsedBody.data.closed_lost_reason,
        note: parsedBody.data.closed_lost_note,
        circleBackOn: parsedBody.data.circle_back_on,
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Closed lost requires a reason.",
        },
        { status: 400 },
      );
    }
  }
  const outcome =
    stageKey === "unqualified" && existing.stage !== "unqualified"
      ? {
          unqualified: {
            reason: parsedBody.data.unqualified_reason,
            note: parsedBody.data.unqualified_note,
          },
          disqualified: null,
        }
      : stageKey === "disqualified" && existing.stage !== "disqualified"
        ? {
            unqualified: null,
            disqualified: {
              reason: parsedBody.data.disqualified_reason,
              note: parsedBody.data.disqualified_note,
            },
          }
        : null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (stageKey) {
      await changeProspectStage(
        client,
        parsedId.data,
        stageKey,
        identity,
        closedLost,
        outcome,
      );
    }
    if (parsedBody.data.assigned_owner_id !== undefined) {
      const newOwnerId = parsedBody.data.assigned_owner_id;
      let newOwnerName = "Unassigned";
      if (newOwnerId) {
        const owner = await client.query<{ name: string }>(
          `SELECT name FROM crm.users WHERE id = $1::uuid AND is_active = true`,
          [newOwnerId],
        );
        if (!owner.rows[0]) {
          await client.query("ROLLBACK");
          return Response.json(
            { error: "Assigned owner is not an active CRM user." },
            { status: 400 },
          );
        }
        newOwnerName = owner.rows[0].name;
      }

      const ownerChange = await client.query<{ old_owner_name: string | null }>(
        `
          WITH previous AS (
            SELECT owner.name AS old_owner_name, p.assigned_user_id
            FROM crm.prospects p
            LEFT JOIN crm.users owner ON owner.id = p.assigned_user_id
            WHERE p.id = $1::uuid
          ),
          updated AS (
            UPDATE crm.prospects
            SET assigned_user_id = $2::uuid, updated_at = now()
            FROM previous
            WHERE prospects.id = $1::uuid
              AND prospects.assigned_user_id IS DISTINCT FROM $2::uuid
            RETURNING previous.old_owner_name
          )
          SELECT old_owner_name FROM updated
        `,
        [parsedId.data, newOwnerId],
      );
      if (ownerChange.rows[0]) {
        await client.query(
          `
            INSERT INTO crm.activities
              (prospect_id, type, body, actor_type, actor_name, metadata)
            VALUES (
              $1::uuid,
              'note',
              $2,
              'ai',
              $3,
              jsonb_build_object('change', 'assigned_owner')
            )
          `,
          [
            parsedId.data,
            `Owner changed from ${ownerChange.rows[0].old_owner_name ?? "Unassigned"} to ${newOwnerName}`,
            identity.actorName,
          ],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return Response.json({ data: await getAiProspect(parsedId.data) });
}
