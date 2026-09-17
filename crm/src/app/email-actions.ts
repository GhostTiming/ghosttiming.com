"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import {
  discardProspectEmailDraft,
  listProspectEmailDrafts,
  markProspectEmailDraftSent,
  parseRecipientField,
  prepareProspectEmailSend,
  saveProspectEmailDraft,
} from "@/lib/crm/email-compose";

const uuid = z.string().uuid();
const optionalText = z.string().trim().max(20_000).optional();

function refreshProspect(prospectId: string) {
  revalidatePath(`/prospecting/${prospectId}`, "layout");
  revalidatePath("/prospecting", "layout");
}

const composeSchema = z.object({
  prospectId: uuid,
  draftId: uuid.optional(),
  to: z.string().trim().max(2000).optional().default(""),
  cc: z.string().trim().max(2000).optional().default(""),
  subject: z.string().max(500).optional().default(""),
  body: z.string().max(20_000).optional().default(""),
  gmailThreadId: optionalText,
  inReplyToRfcMessageId: optionalText,
  replyToGmailMessageId: optionalText,
});

function composeFromParsed(input: z.infer<typeof composeSchema>) {
  return {
    prospectId: input.prospectId,
    draftId: input.draftId,
    toAddresses: parseRecipientField(input.to),
    ccAddresses: parseRecipientField(input.cc),
    subject: input.subject,
    bodyText: input.body,
    gmailThreadId: input.gmailThreadId || null,
    inReplyToRfcMessageId: input.inReplyToRfcMessageId || null,
    replyToGmailMessageId: input.replyToGmailMessageId || null,
  };
}

export async function saveProspectEmailDraftAction(input: z.infer<typeof composeSchema>) {
  const user = await requireProspectingUser();
  const parsed = composeSchema.parse(input);
  const client = await getPool().connect();
  try {
    const draft = await saveProspectEmailDraft(client, {
      ...composeFromParsed(parsed),
      actorUserId: user.id,
    });
    refreshProspect(parsed.prospectId);
    return { draft };
  } finally {
    client.release();
  }
}

export async function discardProspectEmailDraftAction(formData: FormData) {
  await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const draftId = uuid.parse(formData.get("draftId"));
  const client = await getPool().connect();
  try {
    await discardProspectEmailDraft(client, prospectId, draftId);
  } finally {
    client.release();
  }
  refreshProspect(prospectId);
}

export async function prepareProspectEmailSendAction(input: z.infer<typeof composeSchema>) {
  await requireProspectingUser();
  const parsed = composeSchema.parse(input);
  const client = await getPool().connect();
  try {
    return await prepareProspectEmailSend(client, composeFromParsed(parsed));
  } finally {
    client.release();
  }
}

export async function markProspectEmailDraftSentAction(input: {
  prospectId: string;
  draftId: string;
  gmailMessageId: string;
}) {
  await requireProspectingUser();
  const parsed = z
    .object({
      prospectId: uuid,
      draftId: uuid,
      gmailMessageId: z.string().trim().min(1).max(200),
    })
    .parse(input);
  const client = await getPool().connect();
  try {
    await markProspectEmailDraftSent(client, parsed);
  } finally {
    client.release();
  }
  refreshProspect(parsed.prospectId);
}

export async function listOpenProspectEmailDraftsAction(prospectId: string) {
  await requireProspectingUser();
  const id = uuid.parse(prospectId);
  const client = await getPool().connect();
  try {
    return listProspectEmailDrafts(client, id);
  } finally {
    client.release();
  }
}
