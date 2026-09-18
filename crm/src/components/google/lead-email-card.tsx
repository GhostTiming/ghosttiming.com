"use client";

import { Mail, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  discardProspectEmailDraftAction,
  markProspectEmailDraftSentAction,
  prepareProspectEmailSendAction,
  saveProspectEmailDraftAction,
} from "@/app/email-actions";
import { useGoogleSession } from "@/components/google/google-session-provider";
import { EmailSignaturePicker } from "@/components/email-signature-picker";
import {
  composeWarningForDraft,
  formatRecipientField,
  parseRecipientField,
  type EmailDraftRow,
  type ProspectEmailThread,
} from "@/lib/crm/email-compose";
import {
  appendEmailSignature,
  defaultSignatureId,
} from "@/lib/crm/email-signature-html";
import type { EmailSignatureSummary } from "@/lib/crm/email-signatures";
import { sendGmailMessage, getGmailMessage } from "@/lib/google/gmail-api";
import { buildGmailMime, encodeGmailRaw, replySubject } from "@/lib/google/gmail-mime";
import { parseGmailMessage } from "@/lib/google/gmail-parse";

type ContactEmail = { value: string; isPrimary: boolean; status: string };

function usableEmails(contacts: ContactEmail[]) {
  return contacts.filter(
    (contact) => contact.status !== "invalid" && contact.status !== "opted_out",
  );
}

function defaultTo(contacts: ContactEmail[]) {
  const usable = usableEmails(contacts);
  const primary = usable.find((contact) => contact.isPrimary);
  return (primary ?? usable[0])?.value ?? "";
}

export function LeadEmailCard({
  prospectId,
  raceName,
  doNotContact,
  contactEmails,
  drafts,
  threads,
  initialReplyThreadId,
  initialDraftId,
  variant = "module",
  collapsible = false,
  signatures = [],
}: {
  prospectId: string;
  raceName: string;
  doNotContact: boolean;
  contactEmails: ContactEmail[];
  drafts: EmailDraftRow[];
  threads: ProspectEmailThread[];
  initialReplyThreadId?: string | null;
  initialDraftId?: string | null;
  variant?: "module" | "workspace";
  collapsible?: boolean;
  signatures?: EmailSignatureSummary[];
}) {
  const google = useGoogleSession();
  const router = useRouter();
  const [openDrafts, setOpenDrafts] = useState(drafts);
  const [draftsSnapshot, setDraftsSnapshot] = useState(drafts);
  if (drafts !== draftsSnapshot) {
    setDraftsSnapshot(drafts);
    setOpenDrafts(drafts);
  }
  const [composing, setComposing] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [gmailThreadId, setGmailThreadId] = useState<string | null>(null);
  const [inReplyToRfcMessageId, setInReplyToRfcMessageId] = useState<string | null>(null);
  const [replyToGmailMessageId, setReplyToGmailMessageId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [signatureId, setSignatureId] = useState(() => defaultSignatureId(signatures));
  const skipAutosave = useRef(true);
  const openedInitial = useRef(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const draftIdRef = useRef<string | null>(null);

  const payload = useMemo(
    () => ({
      prospectId,
      draftId: draftId ?? undefined,
      to,
      cc,
      subject,
      body,
      gmailThreadId: gmailThreadId ?? undefined,
      inReplyToRfcMessageId: inReplyToRfcMessageId ?? undefined,
      replyToGmailMessageId: replyToGmailMessageId ?? undefined,
    }),
    [body, cc, draftId, gmailThreadId, inReplyToRfcMessageId, prospectId, replyToGmailMessageId, subject, to],
  );

  const warning = composeWarningForDraft({
    doNotContact,
    toAddresses: parseRecipientField(to),
  });
  const fromEmail = google.connection?.google_email ?? null;
  const hasContactEmail = usableEmails(contactEmails).length > 0;
  const sendBlocked = !hasContactEmail || doNotContact;

  function fillComposer(next: {
    draftId?: string | null;
    to: string;
    cc?: string;
    subject: string;
    body?: string;
    gmailThreadId?: string | null;
    inReplyToRfcMessageId?: string | null;
    replyToGmailMessageId?: string | null;
  }) {
    skipAutosave.current = true;
    draftIdRef.current = next.draftId ?? null;
    setDraftId(next.draftId ?? null);
    setTo(next.to);
    setCc(next.cc ?? "");
    setSubject(next.subject);
    setBody(next.body ?? "");
    setGmailThreadId(next.gmailThreadId ?? null);
    setInReplyToRfcMessageId(next.inReplyToRfcMessageId ?? null);
    setReplyToGmailMessageId(next.replyToGmailMessageId ?? null);
    setComposing(true);
    setError(null);
    setStatus(null);
  }

  function startNewEmail() {
    fillComposer({
      to: defaultTo(contactEmails),
      subject: "",
      body: "",
    });
  }

  function startReply(thread: ProspectEmailThread) {
    fillComposer({
      to: formatRecipientField(thread.replyTo),
      cc: formatRecipientField(thread.replyCc),
      subject: replySubject(thread.subject),
      gmailThreadId: thread.gmailThreadId,
      inReplyToRfcMessageId: thread.lastRfcMessageId,
      replyToGmailMessageId: thread.lastGmailMessageId,
    });
  }

  function openDraft(draft: EmailDraftRow) {
    fillComposer({
      draftId: draft.id,
      to: formatRecipientField(draft.to_addresses),
      cc: formatRecipientField(draft.cc_addresses),
      subject: draft.subject,
      body: draft.body_text,
      gmailThreadId: draft.gmail_thread_id,
      inReplyToRfcMessageId: draft.in_reply_to_rfc_message_id,
      replyToGmailMessageId: draft.reply_to_gmail_message_id,
    });
  }

  useEffect(() => {
    if (openedInitial.current) return;
    openedInitial.current = true;
    if (initialDraftId) {
      const draft = drafts.find((item) => item.id === initialDraftId);
      if (draft) {
        // Mount-only: open the draft named in the query string.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot composer hydrate from the URL
        openDraft(draft);
        return;
      }
    }
    if (initialReplyThreadId) {
      const thread = threads.find((item) => item.gmailThreadId === initialReplyThreadId);
      if (thread) startReply(thread);
    }
    // Open once from the inbound query string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function openPanel() {
      if (detailsRef.current) detailsRef.current.open = true;
    }
    function openFromHash() {
      if (window.location.hash === "#lead-email") openPanel();
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  useEffect(() => {
    if (composing && detailsRef.current) detailsRef.current.open = true;
  }, [composing]);

  useEffect(() => {
    if (!composing) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void persistDraft().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not save the draft.");
      });
    }, 1200);
    return () => window.clearTimeout(handle);
    // payload identity tracks the fields we persist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.to, payload.cc, payload.subject, payload.body]);

  async function persistDraft() {
    const result = await saveProspectEmailDraftAction({
      ...payload,
      draftId: draftIdRef.current ?? payload.draftId,
    });
    draftIdRef.current = result.draft.id;
    setDraftId(result.draft.id);
    setOpenDrafts((current) => {
      const next = current.filter((item) => item.id !== result.draft.id);
      return [result.draft, ...next];
    });
    return result.draft.id;
  }

  async function saveDraft() {
    setBusy("save");
    setError(null);
    try {
      await persistDraft();
      setStatus("Draft saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function sendEmail() {
    setError(null);
    setStatus(null);
    setBusy("send");
    try {
      const savedId = await persistDraft();
      const prepared = await prepareProspectEmailSendAction({
        ...payload,
        draftId: savedId,
      });
      if (!prepared.allowed) {
        setError(prepared.error);
        return;
      }
      if (!google.accessToken) {
        await google.connect();
      }
      const { token, email: from, googleSub } = await google.ensureGmailSendAccess();
      const composed = appendEmailSignature({
        bodyText: prepared.bodyText,
        signatureHtml: signatures.find((item) => item.id === signatureId)?.body_html,
      });
      const mime = buildGmailMime({
        from,
        to: prepared.toAddresses,
        cc: prepared.ccAddresses,
        subject: prepared.subject,
        body: composed.text,
        html: composed.html,
        inReplyTo: prepared.inReplyToRfcMessageId,
        references: prepared.inReplyToRfcMessageId,
      });
      const sent = await sendGmailMessage(token, {
        raw: encodeGmailRaw(mime),
        threadId: prepared.gmailThreadId,
      });
      if (!sent.id) throw new Error("Gmail did not return a message id.");
      const raw = await getGmailMessage(token, sent.id);
      const parsed = parseGmailMessage(raw, from);
      if (parsed) {
        const ingestResponse = await fetch("/api/google/gmail/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            googleSub,
            googleEmail: from,
            messages: [
              {
                ...parsed,
                prospectIds: [prospectId],
                bookingIds: [],
                organizationIds: [],
                personIds: [],
              },
            ],
          }),
        });
        if (!ingestResponse.ok) {
          setStatus("Email sent. Re-sync Gmail if it does not show on this lead yet.");
        }
      }
      await markProspectEmailDraftSentAction({
        prospectId,
        draftId: savedId,
        gmailMessageId: sent.id,
      });
      setOpenDrafts((current) => current.filter((item) => item.id !== savedId));
      setComposing(false);
      setStatus("Email sent.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the email.");
    } finally {
      setBusy(null);
    }
  }

  const workspace = variant === "workspace";
  const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={workspace ? "text-lg font-bold" : "font-bold"}>Email</h2>
        <p className="mt-1 text-sm text-slate-500">
          {fromEmail ? `Send as ${fromEmail}` : "Connect Google to send from your Gmail."}
          {openDrafts.length ? ` · ${openDrafts.length} draft${openDrafts.length === 1 ? "" : "s"}` : ""}
          {threads.length ? ` · ${threads.length} thread${threads.length === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startNewEmail();
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800"
      >
        <Mail aria-hidden className="size-4" />
        New email
      </button>
    </div>
  );

  const emailBody = (
    <>
      {!hasContactEmail ? (
        <p className="mt-3 text-sm text-amber-800">
          Add an email address on this lead before sending.
        </p>
      ) : null}
      {warning && composing ? (
        <p className="mt-3 text-sm text-amber-800">{warning}</p>
      ) : null}

      {composing ? (
        <div className={collapsible ? "space-y-3" : "mt-4 space-y-3 border-t border-slate-200 pt-4"}>
          <div className={workspace ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
            <label className="block text-sm font-medium">
              From
              <input
                value={fromEmail ?? ""}
                readOnly
                placeholder="Connect Google to send from your Gmail"
                className={`${field} bg-slate-50 text-slate-600`}
              />
            </label>
            <label className="block text-sm font-medium">
              To
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={field}
                placeholder="name@example.org"
              />
            </label>
            <label className="block text-sm font-medium">
              Cc
              <input
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                className={field}
              />
            </label>
            <label className="block text-sm font-medium">
              Subject
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={raceName}
                className={field}
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Message
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={workspace ? 12 : 8}
              className={field}
            />
          </label>
          <EmailSignaturePicker
            signatures={signatures}
            value={signatureId}
            onChange={setSignatureId}
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {status ? <p className="text-sm text-emerald-800">{status}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveDraft()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={busy !== null || sendBlocked}
              onClick={() => void sendEmail()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
            >
              {busy === "send" ? (
                <>
                  <RefreshCw aria-hidden className="size-4 animate-spin" />
                  Sending…
                </>
              ) : google.accessToken ? (
                "Send"
              ) : (
                "Connect Google and send"
              )}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="px-3 py-2 text-sm font-semibold text-slate-600"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {openDrafts.length ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Drafts
          </h3>
          <div className={workspace ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}>
          {openDrafts.map((draft) => (
            <div
              key={draft.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <button
                type="button"
                onClick={() => openDraft(draft)}
                className="min-w-0 text-left font-medium text-cyan-700 hover:text-cyan-900"
              >
                <span className="block truncate">
                  {draft.subject.trim() || "(No subject)"}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  To {formatRecipientField(draft.to_addresses) || "no recipient"}
                </span>
              </button>
              <form action={discardProspectEmailDraftAction}>
                <input type="hidden" name="prospectId" value={prospectId} />
                <input type="hidden" name="draftId" value={draft.id} />
                <button className="text-xs font-semibold text-red-700">Discard</button>
              </form>
            </div>
          ))}
          </div>
        </div>
      ) : null}

      {threads.length ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Threads
          </h3>
          <div className={workspace && !composing ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}>
          {threads.slice(0, 8).map((thread) => (
            <div
              key={thread.gmailThreadId}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">
                  {thread.subject || "(No subject)"}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
                  {thread.lastFrom ? ` · ${thread.lastFrom}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startReply(thread)}
                className="shrink-0 text-xs font-semibold text-cyan-700 hover:text-cyan-900"
              >
                Reply
              </button>
            </div>
          ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No Gmail threads on this lead yet. Re-sync Gmail after adding a contact.
        </p>
      )}
    </>
  );

  return (
    <section
      id="lead-email"
      className={`scroll-mt-24 rounded-2xl border border-slate-200 bg-white shadow-sm ${
        workspace ? "p-5 sm:p-6" : "p-5"
      }`}
    >
      {collapsible ? (
        <details ref={detailsRef}>
          <summary className="cursor-pointer">
            {heading}
          </summary>
          <div className="mt-4 border-t border-slate-200 pt-4">
            {emailBody}
          </div>
        </details>
      ) : (
        <>
          {heading}
          {emailBody}
        </>
      )}
    </section>
  );
}

