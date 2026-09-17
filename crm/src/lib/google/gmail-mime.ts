export type GmailComposeInput = {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
};

function encodeHeaderValue(value: string) {
  const trimmed = value.replace(/[\r\n]+/g, " ").trim();
  if (!trimmed || /^[\x20-\x7E]*$/.test(trimmed)) return trimmed;
  const encoded = Buffer.from(trimmed, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

export function wrapRfcMessageId(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}

export function replySubject(subject: string | null | undefined) {
  const text = subject?.replace(/[\r\n]+/g, " ").trim() ?? "";
  if (!text) return "Re:";
  return /^re\s*:/i.test(text) ? text : `Re: ${text}`;
}

export function buildGmailMime(input: GmailComposeInput) {
  if (!input.to.length) {
    throw new Error("Add at least one recipient before sending.");
  }
  const lines = [
    `From: ${input.from.trim()}`,
    `To: ${input.to.join(", ")}`,
  ];
  if (input.cc?.length) lines.push(`Cc: ${input.cc.join(", ")}`);
  lines.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  const inReplyTo = wrapRfcMessageId(input.inReplyTo);
  const references = input.references
    ? input.references
        .split(/\s+/)
        .map((id) => wrapRfcMessageId(id))
        .filter(Boolean)
        .join(" ")
    : inReplyTo;
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(input.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
  return lines.join("\r\n");
}

export function encodeGmailRaw(mime: string) {
  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
