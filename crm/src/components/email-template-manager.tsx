"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteEmailTemplateAction,
  restoreDefaultCrewEmailTemplateAction,
  saveEmailTemplateAction,
} from "@/app/settings-actions";
import { CREW_EMAIL_PLACEHOLDERS } from "@/lib/crm/email-placeholders";
import type { EmailTemplateRow } from "@/lib/crm/email-templates";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function EmailTemplateManager({
  templates,
}: {
  templates: EmailTemplateRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(templates);
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? "new");
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [subject, setSubject] = useState(selected?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(selected?.body_html ?? "");
  const [busy, setBusy] = useState<"save" | "delete" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function loadTemplate(row: EmailTemplateRow | null) {
    setSelectedId(row?.id ?? "new");
    setName(row?.name ?? "");
    setSubject(row?.subject ?? "");
    setBodyHtml(row?.body_html ?? "");
    setError(null);
    setStatus(null);
  }

  function insertPlaceholder(key: string) {
    const token = `{{${key}}}`;
    setBodyHtml((current) => (current ? `${current}${token}` : token));
  }

  async function saveTemplate() {
    setBusy("save");
    setError(null);
    setStatus(null);
    try {
      const result = await saveEmailTemplateAction({
        id: selectedId === "new" ? undefined : selectedId,
        name,
        subject,
        bodyHtml,
      });
      const saved = result.template;
      setRows((current) => {
        const next = current.filter((row) => row.id !== saved.id);
        next.push(saved);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      loadTemplate(saved);
      setStatus("Template saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the template.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteTemplate() {
    if (selectedId === "new") {
      loadTemplate(rows[0] ?? null);
      return;
    }
    if (!window.confirm("Delete this email template?")) return;
    setBusy("delete");
    setError(null);
    setStatus(null);
    try {
      await deleteEmailTemplateAction(selectedId);
      const remaining = rows.filter((row) => row.id !== selectedId);
      setRows(remaining);
      loadTemplate(remaining[0] ?? null);
      setStatus("Template deleted.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the template.");
    } finally {
      setBusy(null);
    }
  }

  async function restoreDefault() {
    setBusy("restore");
    setError(null);
    setStatus(null);
    try {
      const result = await restoreDefaultCrewEmailTemplateAction();
      const saved = result.template;
      setRows((current) => {
        const next = current.filter((row) => row.id !== saved.id && row.name !== saved.name);
        next.push(saved);
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      loadTemplate(saved);
      setStatus("Remote crew notes template restored.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore the default template.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="email-templates" className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Email templates</h2>
          <p className="mt-1 text-sm text-slate-600">
            Build HTML templates for crew mail. Placeholders fill from the booking,
            your profile, and your default send mailbox.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadTemplate(null)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            New template
          </button>
          <button
            type="button"
            onClick={() => void restoreDefault()}
            disabled={busy !== null}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "restore" ? "Restoring…" : "Restore Remote crew notes"}
          </button>
        </div>
      </div>

      <label className="block text-sm">
        Template
        <select
          className={field}
          value={selectedId}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "new") {
              loadTemplate(null);
              return;
            }
            const row = rows.find((item) => item.id === value) ?? null;
            loadTemplate(row);
          }}
        >
          <option value="new">New template</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Name
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-sm">
        Subject
        <input
          className={field}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="{{event_name}} — race-day crew notes"
        />
      </label>
      <div>
        <p className="text-sm font-medium text-slate-800">Placeholders</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CREW_EMAIL_PLACEHOLDERS.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.label}
              onClick={() => insertPlaceholder(item.key)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-cyan-600 hover:bg-cyan-50"
            >
              {`{{${item.key}}}`}
            </button>
          ))}
        </div>
      </div>
      <label className="block text-sm">
        HTML
        <textarea
          className={`${field} min-h-64 font-mono text-xs`}
          value={bodyHtml}
          onChange={(event) => setBodyHtml(event.target.value)}
          placeholder="Paste or write HTML. Click a placeholder above to insert it."
        />
      </label>
      <div>
        <p className="text-sm font-medium text-slate-800">Preview</p>
        <iframe
          title={`${name || "Email template"} preview`}
          sandbox=""
          srcDoc={bodyHtml || "<p style='font-family:sans-serif;color:#6b7280'>Template HTML will preview here.</p>"}
          className="mt-2 h-[28rem] w-full rounded-lg border border-slate-200 bg-slate-50"
        />
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {status ? <p className="text-sm text-emerald-800">{status}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void saveTemplate()}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
        >
          {busy === "save" ? "Saving…" : "Save template"}
        </button>
        <button
          type="button"
          disabled={busy !== null || selectedId === "new"}
          onClick={() => void deleteTemplate()}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
    </section>
  );
}
