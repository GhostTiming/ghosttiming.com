"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteEmailSignatureAction,
  saveEmailSignatureAction,
} from "@/app/settings-actions";
import {
  DEFAULT_EMAIL_SIGNATURE_HTML,
  DEFAULT_EMAIL_SIGNATURE_NAME,
  signatureImageTag,
} from "@/lib/crm/email-signature-html";
import type { EmailSignatureRow } from "@/lib/crm/email-signatures";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function EmailSignatureManager({
  signatures,
}: {
  signatures: EmailSignatureRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(signatures);
  const [selectedId, setSelectedId] = useState(signatures[0]?.id ?? "new");
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [bodyHtml, setBodyHtml] = useState(selected?.body_html ?? "");
  const [isDefault, setIsDefault] = useState(selected?.is_default ?? true);
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function loadSignature(row: EmailSignatureRow | null) {
    setSelectedId(row?.id ?? "new");
    setName(row?.name ?? "");
    setBodyHtml(row?.body_html ?? "");
    setIsDefault(row?.is_default ?? rows.length === 0);
    setError(null);
    setStatus(null);
  }

  function insertHtml(snippet: string) {
    setBodyHtml((current) => (current ? `${current}\n${snippet}` : snippet));
  }

  async function saveSignature() {
    setBusy("save");
    setError(null);
    setStatus(null);
    try {
      const result = await saveEmailSignatureAction({
        id: selectedId === "new" ? undefined : selectedId,
        name,
        bodyHtml,
        isDefault,
      });
      setRows((current) => {
        const without = current
          .filter((row) => row.id !== result.signature.id)
          .map((row) =>
            result.signature.is_default ? { ...row, is_default: false } : row,
          );
        return [result.signature, ...without].sort((left, right) => {
          if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
      });
      loadSignature(result.signature);
      setStatus("Signature saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that signature.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSignature() {
    if (selectedId === "new") return;
    setBusy("delete");
    setError(null);
    setStatus(null);
    try {
      await deleteEmailSignatureAction(selectedId);
      const remaining = rows.filter((row) => row.id !== selectedId);
      setRows(remaining);
      loadSignature(remaining[0] ?? null);
      setStatus("Signature deleted.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete that signature.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="email-signatures" className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Email signatures</h2>
          <p className="mt-1 text-sm text-slate-600">
            Save HTML signatures with images and links, then pick one when you send
            CRM email. Host images on a public https URL so Gmail can display them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadSignature(null)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            New signature
          </button>
          <button
            type="button"
            onClick={() => {
              setName((current) => current || DEFAULT_EMAIL_SIGNATURE_NAME);
              setBodyHtml(DEFAULT_EMAIL_SIGNATURE_HTML);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Insert Ghost Timing starter
          </button>
        </div>
      </div>

      <label className="block text-sm">
        Signature
        <select
          className={field}
          value={selectedId}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "new") {
              loadSignature(null);
              return;
            }
            loadSignature(rows.find((item) => item.id === value) ?? null);
          }}
        >
          <option value="new">New signature</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {row.is_default ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Name
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        />
        Use as my default signature
      </label>
      <div>
        <p className="text-sm font-medium text-slate-800">Insert image from URL</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            className={field}
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://…"
          />
          <button
            type="button"
            onClick={() => {
              try {
                insertHtml(signatureImageTag(imageUrl));
                setImageUrl("");
                setError(null);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not insert that image.");
              }
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 sm:mt-1"
          >
            Insert image
          </button>
        </div>
      </div>
      <label className="block text-sm">
        HTML
        <textarea
          className={`${field} min-h-48 font-mono text-xs`}
          value={bodyHtml}
          onChange={(event) => setBodyHtml(event.target.value)}
          placeholder="Paste signature HTML from Gmail or Outlook, or insert the starter above."
        />
      </label>
      <div>
        <p className="text-sm font-medium text-slate-800">Preview</p>
        <iframe
          title={`${name || "Email signature"} preview`}
          sandbox=""
          srcDoc={
            bodyHtml ||
            "<p style='font-family:sans-serif;color:#6b7280'>Signature HTML will preview here.</p>"
          }
          className="mt-2 h-48 w-full rounded-lg border border-slate-200 bg-slate-50"
        />
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {status ? <p className="text-sm text-emerald-800">{status}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void saveSignature()}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
        >
          {busy === "save" ? "Saving…" : "Save signature"}
        </button>
        <button
          type="button"
          disabled={busy !== null || selectedId === "new"}
          onClick={() => void deleteSignature()}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
    </section>
  );
}
