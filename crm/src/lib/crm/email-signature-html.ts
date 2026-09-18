import { CREW_EMAIL_LOGO_URL } from "./crew-email";
import { escapeHtml, htmlToPlainText } from "./email-placeholders";

export const DEFAULT_EMAIL_SIGNATURE_NAME = "Ghost Timing";

export const DEFAULT_EMAIL_SIGNATURE_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111827">
  <tr>
    <td style="padding-bottom:10px">
      <a href="https://ghosttiming.com" target="_blank" rel="noopener noreferrer">
        <img src="${CREW_EMAIL_LOGO_URL}" alt="Ghost Timing" width="180" style="display:block;border:0;max-width:180px;height:auto" />
      </a>
    </td>
  </tr>
  <tr>
    <td>
      <strong>Your name</strong><br />
      Ghost Timing<br />
      <a href="https://ghosttiming.com" target="_blank" rel="noopener noreferrer">ghosttiming.com</a>
    </td>
  </tr>
</table>`;

export function signatureImageTag(url: string) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Use an http or https image URL so Gmail can load it.");
  }
  return `<img src="${escapeHtml(trimmed)}" alt="" width="180" style="display:block;border:0;max-width:240px;height:auto" />`;
}

export function sanitizeSignatureHtml(html: string) {
  let value = html.replace(/\u0000/g, "");
  value = value.replace(/<script[\s\S]*?<\/script>/gi, "");
  value = value.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  value = value.replace(/<object[\s\S]*?<\/object>/gi, "");
  value = value.replace(/<embed[\s\S]*?>/gi, "");
  value = value.replace(/<link[\s\S]*?>/gi, "");
  value = value.replace(/<meta[\s\S]*?>/gi, "");
  value = value.replace(/<base[\s\S]*?>/gi, "");
  value = value.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  value = value.replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "$1=$2$2");
  value = value.replace(/(href|src)\s*=\s*javascript:[^\s>]+/gi, "");
  return value.trim();
}

export function plainTextToHtml(text: string) {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111827">${escapeHtml(trimmed).replace(/\n/g, "<br />")}</div>`;
}

export function appendEmailSignature(input: {
  bodyText?: string | null;
  bodyHtml?: string | null;
  signatureHtml?: string | null;
  htmlSeparator?: string;
  textSeparator?: string;
}) {
  const signature = sanitizeSignatureHtml(input.signatureHtml ?? "");
  const bodyText = (input.bodyText ?? "").replace(/\r\n/g, "\n").trim();
  const bodyHtml = (input.bodyHtml ?? "").trim() || (bodyText ? plainTextToHtml(bodyText) : "");
  if (!signature) {
    return {
      text: bodyText,
      html: (input.bodyHtml ?? "").trim() || undefined,
    };
  }
  const htmlSeparator = input.htmlSeparator ?? "<br /><br />";
  const textSeparator = input.textSeparator ?? "\n\n";
  return {
    text: [bodyText, htmlToPlainText(signature)].filter(Boolean).join(textSeparator),
    html: `${bodyHtml}${bodyHtml ? htmlSeparator : ""}${signature}`,
  };
}

export function defaultSignatureId(rows?: { id: string; is_default: boolean }[] | null) {
  return rows?.find((row) => row.is_default)?.id ?? "";
}
