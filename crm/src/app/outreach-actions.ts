"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import {
  requireBookingOperator,
  requireProspectingUser,
} from "@/lib/auth/server";
import {
  activityTypeFromEventType,
  dispositions,
  timelineEventTypes,
} from "@/lib/crm/domain";
import {
  applyTerminalDisposition,
  changeProspectStage,
  insertActivityAndFollowUp,
} from "@/lib/crm/mutations";
import {
  formatMeetingActivityBody,
  isMeetingActivity,
  parseMeetingAttendees,
  parseMeetingDurationMinutes,
  parseMeetingMetadata,
  parseMeetingStart,
  validateMeetingWrapUpInput,
  type MeetingActivityMetadata,
  type MeetingWrapUp,
  type OutreachRecordKind,
} from "@/lib/crm/outreach-activity";

const uuid = z.string().uuid();

function refreshOutreach(input: { prospectId?: string; bookingId?: string }) {
  if (input.prospectId) {
    revalidatePath(`/prospecting/${input.prospectId}`);
    revalidatePath("/prospecting");
  }
  if (input.bookingId) {
    revalidatePath(`/bookings/${input.bookingId}`);
    revalidatePath("/bookings");
  }
  revalidatePath("/tasks");
}

async function actorForRecord(input: {
  prospectId?: string;
  bookingId?: string;
}) {
  if (input.prospectId && !input.bookingId) {
    const user = await requireProspectingUser();
    return { user, prospectId: input.prospectId, bookingId: undefined };
  }
  if (input.bookingId && !input.prospectId) {
    const { user } = await requireBookingOperator(input.bookingId);
    return { user, prospectId: undefined, bookingId: input.bookingId };
  }
  throw new Error("Choose a prospect or a booking.");
}

export async function logOutreachActivityAction(formData: FormData) {
  const prospectId = String(formData.get("prospectId") ?? "") || undefined;
  const bookingId = String(formData.get("bookingId") ?? "") || undefined;
  const { user } = await actorForRecord({ prospectId, bookingId });
  const parsed = z
    .object({
      eventType: z.enum(timelineEventTypes),
      body: z.string().max(10_000).optional(),
      disposition: z.enum(dispositions).optional(),
      followUpTitle: z.string().trim().max(500).optional(),
      followUpDueAt: z.string().optional(),
    })
    .parse({
      eventType: formData.get("eventType"),
      body: String(formData.get("body") ?? ""),
      disposition: formData.get("disposition") || undefined,
      followUpTitle: formData.get("followUpTitle") || undefined,
      followUpDueAt: formData.get("followUpDueAt") || undefined,
    });
  const bodyText = parsed.body?.trim() ?? "";
  const dueAt = parsed.followUpDueAt
    ? z.coerce.date().parse(parsed.followUpDueAt)
    : undefined;
  if (Boolean(parsed.followUpTitle) !== Boolean(dueAt)) {
    throw new Error("A follow-up needs both an action and a due date.");
  }

  let body = bodyText;
  let occurredAt: Date | undefined;
  const metadata: Record<string, unknown> = { eventType: parsed.eventType };

  if (parsed.eventType === "meeting") {
    const subject = String(formData.get("meetingSubject") ?? "").trim() || "Meeting";
    const startsAt = parseMeetingStart(String(formData.get("meetingStartsAt") ?? ""));
    const durationMinutes = parseMeetingDurationMinutes(
      formData.get("meetingDurationMinutes"),
    );
    const attendees = parseMeetingAttendees(
      String(formData.get("meetingAttendees") ?? "").split(/[\s,;]+/),
    );
    const includeGoogleMeet = String(formData.get("includeGoogleMeet") ?? "") === "true";
    const googleEventId = String(formData.get("googleEventId") ?? "").trim();
    const googleCalendarId = String(formData.get("googleCalendarId") ?? "").trim();
    if (!googleEventId || !googleCalendarId) {
      throw new Error("Create the calendar invite before logging the meeting.");
    }
    const htmlLink = String(formData.get("htmlLink") ?? "").trim() || null;
    const hangoutLink = String(formData.get("hangoutLink") ?? "").trim() || null;
    const meeting: MeetingActivityMetadata = {
      subject,
      startsAt: startsAt.toISOString(),
      durationMinutes,
      attendees,
      includeGoogleMeet,
      googleCalendarId,
      googleEventId,
      htmlLink,
      hangoutLink,
      agenda: bodyText || undefined,
    };
    body = formatMeetingActivityBody({
      subject,
      startsAt: meeting.startsAt,
      durationMinutes,
      attendees,
      agenda: bodyText,
      hangoutLink,
      htmlLink,
    });
    occurredAt = startsAt;
    metadata.meeting = meeting;
  } else if (!body) {
    throw new Error("Describe what happened.");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await insertActivityAndFollowUp(client, {
      prospectId,
      bookingId,
      type: activityTypeFromEventType(parsed.eventType),
      body,
      disposition: parsed.eventType === "meeting" ? undefined : parsed.disposition,
      occurredAt,
      actorType: "human",
      actorUserId: user.id,
      actorName: user.name,
      metadata,
      followUp:
        parsed.followUpTitle && dueAt
          ? { title: parsed.followUpTitle, dueAt, assignedUserId: user.id }
          : undefined,
    });
    if (prospectId) {
      await applyTerminalDisposition(client, prospectId, parsed.disposition);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  refreshOutreach({ prospectId, bookingId });
}

export async function wrapUpMeetingAction(formData: FormData) {
  const input = z
    .object({
      activityId: uuid,
      notes: z.string().trim().min(1).max(10_000),
      outcome: z.enum(["qualified", "unqualified", "notes"]).optional(),
      unqualifiedReason: z.string().optional(),
    })
    .parse({
      activityId: formData.get("activityId"),
      notes: formData.get("notes"),
      outcome: formData.get("outcome") || undefined,
      unqualifiedReason: formData.get("unqualifiedReason") || undefined,
    });

  const existing = await getPool().query<{
    type: string;
    metadata: Record<string, unknown> | null;
    prospect_id: string | null;
    booking_id: string | null;
  }>(
    `
      SELECT type::text, metadata, prospect_id::text, booking_id::text
      FROM crm.activities
      WHERE id = $1::uuid
    `,
    [input.activityId],
  );
  const activity = existing.rows[0];
  if (!activity) throw new Error("Activity not found.");
  if (!isMeetingActivity(activity)) {
    throw new Error("Wrap-up is only available on meeting activities.");
  }

  const recordKind: OutreachRecordKind = activity.prospect_id ? "prospect" : "booking";
  const { user } = await actorForRecord({
    prospectId: activity.prospect_id ?? undefined,
    bookingId: activity.booking_id ?? undefined,
  });

  const meeting = parseMeetingMetadata(activity.metadata);
  if (meeting?.wrapUp) throw new Error("This meeting already has a wrap-up.");

  const validated = validateMeetingWrapUpInput({
    recordKind,
    notes: input.notes,
    outcome: input.outcome ?? (recordKind === "booking" ? "notes" : undefined),
    unqualifiedReason: input.unqualifiedReason,
  });
  if (!validated.success) throw new Error(validated.error);

  const wrapUp: MeetingWrapUp = {
    ...validated.data,
    wrappedAt: new Date().toISOString(),
    wrappedBy: user.name,
  } as MeetingWrapUp;
  const nextMeeting: MeetingActivityMetadata = {
    ...(meeting ?? {
      subject: "Meeting",
      startsAt: new Date().toISOString(),
      durationMinutes: 30,
      attendees: [],
      includeGoogleMeet: false,
    }),
    wrapUp,
  };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE crm.activities
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $1::uuid
      `,
      [
        input.activityId,
        JSON.stringify({
          eventType: "meeting",
          meeting: nextMeeting,
        }),
      ],
    );
    if (validated.data.outcome === "unqualified" && activity.prospect_id) {
      await changeProspectStage(
        client,
        activity.prospect_id,
        "unqualified",
        {
          actorType: "human",
          actorUserId: user.id,
          actorName: user.name,
        },
        null,
        {
          unqualified: {
            reason: validated.data.unqualifiedReason,
            note: validated.data.notes,
          },
        },
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  refreshOutreach({
    prospectId: activity.prospect_id ?? undefined,
    bookingId: activity.booking_id ?? undefined,
  });
}
