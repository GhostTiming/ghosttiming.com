"use client";

import { Mail, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  recordCrewEmailSentAction,
  renderCrewEmailAction,
} from "@/app/crew-email-actions";
import { useGoogleSession } from "@/components/google/google-session-provider";
import {
  formatRecipientField,
  parseRecipientField,
} from "@/lib/crm/email-compose";
import { htmlToPlainText } from "@/lib/crm/email-placeholders";
import type { EmailTemplateSummary } from "@/lib/crm/email-templates";
import { sendGmailMessage, getGmailMessage } from "@/lib/google/gmail-api";
import { buildGmailMime, encodeGmailRaw } from "@/lib/google/gmail-mime";
import { parseGmailMessage } from "@/lib/google/gmail-parse";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function CrewEmailPanel({
  bookingId,
  templates,
  defaultTo,
}: {
  bookingId: string;
  templates: EmailTemplateSummary[];
  defaultTo: string;
}) {
  const router = useRouter();
  const google = useGoogleSession();
  const fromEmail =
    google.sendConnection?.google_email ?? google.connection?.google_email ?? null;
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [prospectId, setProspectId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function loadTemplate(nextTemplateId = templateId) {
    if (!nextTemplateId) {
      setError("Create a crew email template in Settings first.");
      return;
    }
    setBusy("load");
    setError(null);
    setStatus(null);
    try {
      const rendered = await renderCrewEmailAction({
        bookingId,
        templateId: nextTemplateId,
      });
      setTemplateId(rendered.templateId);
      setSubject(rendered.subject);
      setHtml(rendered.html);
      setTo(rendered.to || defaultTo);
      setPersonIds(rendered.personIds);
      setProspectId(rendered.prospectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that template.");
    } finally {
      setBusy(null);
    }
  }

  async function openComposer() {
    setOpen(true);
    if (!html) await loadTemplate();
  }

  async function sendEmail() {
    setError(null);
    setStatus(null);
    const recipients = parseRecipientField(to);
    if (!recipients.length) {
      setError("Add at least one crew recipient before sending.");
      return;
    }
    if (!subject.trim()) {
      setError("Add a subject before sending.");
      return;
    }
    if (!html.trim()) {
      setError("The email has no HTML to send.");
      return;
    }
    setBusy("send");
    try {
      if (!google.accessToken) {
        await google.connect();
      }
      const { token, email: from, googleSub } = await google.ensureGmailSendAccess();
      const mime = buildGmailMime({
        from,
        to: recipients,
        cc: parseRecipientField(cc),
        subject,
        body: htmlToPlainText(html),
        html,
      });
      const sent = await sendGmailMessage(token, { raw: encodeGmailRaw(mime) });
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
                prospectIds: prospectId ? [prospectId] : [],
                bookingIds: [bookingId],
                organizationIds: [],
                personIds,
              },
            ],
          }),
        });
        if (!ingestResponse.ok) {
          setStatus("Email sent. Re-sync Gmail if it does not show on this booking yet.");
        }
      }
      await recordCrewEmailSentAction({
        bookingId,
        subject,
        to: formatRecipientField(recipients),
        html,
        gmailMessageId: sent.id,
      });
      setStatus("Crew email sent.");
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the crew email.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Email assigned crew from a template. Recipients start as the crew emails on this booking.
        </p>
        <button
          type="button"
          onClick={() => void openComposer()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800"
        >
          <Mail aria-hidden className="size-4" />
          Email crew
        </button>
      </div>

      {open ? (
        <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/40 p-3">
          {!templates.length ? (
            <p className="text-sm text-amber-800">
              No templates yet.{" "}
              <Link href="/settings#email-templates" className="font-semibold underline">
                Create one in Settings
              </Link>
              .
            </p>
          ) : (
            <label className="block text-sm font-medium">
              Template
              <select
                className={field}
                value={templateId}
                onChange={(event) => {
                  const next = event.target.value;
                  setTemplateId(next);
                  void loadTemplate(next);
                }}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">
            From
            <input
              value={fromEmail ?? ""}
              readOnly
              placeholder="Connect Google to send from your Gmail"
              className={`${field} bg-white text-slate-600`}
            />
          </label>
          <label className="block text-sm font-medium">
            To
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={field}
              placeholder="crew@example.org"
            />
          </label>
          <label className="block text-sm font-medium">
            Cc
            <input value={cc} onChange={(event) => setCc(event.target.value)} className={field} />
          </label>
          <label className="block text-sm font-medium">
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className={field}
            />
          </label>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Preview</p>
              <button
                type="button"
                disabled={busy !== null || !templateId}
                onClick={() => void loadTemplate()}
                className="text-xs font-semibold text-cyan-800 disabled:opacity-60"
              >
                Reload from template
              </button>
            </div>
            <iframe
              title="Crew email preview"
              sandbox=""
              srcDoc={html || "<p style='font-family:sans-serif;color:#6b7280'>Choose a template to preview.</p>"}
              className="mt-2 h-[28rem] w-full rounded-lg border border-slate-200 bg-white"
            />
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">
              Edit HTML
            </summary>
            <textarea
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              className={`${field} min-h-48 font-mono text-xs`}
            />
          </details>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {status ? <p className="text-sm text-emerald-800">{status}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
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
              onClick={() => setOpen(false)}
              className="px-3 py-2 text-sm font-semibold text-slate-600"
            >
              Close
            </button>
            <Link href="/settings#email-templates" className="px-3 py-2 text-sm font-semibold text-cyan-800">
              Manage templates
            </Link>
          </div>
        </div>
      ) : status ? (
        <p className="text-sm text-emerald-800">{status}</p>
      ) : null}
    </div>
  );
}
