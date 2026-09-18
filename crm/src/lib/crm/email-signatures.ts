import { getPool } from "@/db";
import { sanitizeSignatureHtml } from "@/lib/crm/email-signature-html";

export type EmailSignatureRow = {
  id: string;
  name: string;
  body_html: string;
  is_default: boolean;
  updated_at: string;
};

export type EmailSignatureSummary = {
  id: string;
  name: string;
  body_html: string;
  is_default: boolean;
};

const SIGNATURE_COLUMNS = `
  id::text,
  name,
  body_html,
  is_default,
  updated_at::text
`;

export function asSignatureSummaries(rows: EmailSignatureRow[]): EmailSignatureSummary[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    body_html: row.body_html,
    is_default: row.is_default,
  }));
}

export async function listUserEmailSignatures(userId: string) {
  const result = await getPool().query<EmailSignatureRow>(
    `
      SELECT ${SIGNATURE_COLUMNS}
      FROM crm.email_signatures
      WHERE user_id = $1::uuid
      ORDER BY is_default DESC, name ASC
    `,
    [userId],
  );
  return result.rows;
}

export async function getUserEmailSignature(userId: string, signatureId: string) {
  const result = await getPool().query<EmailSignatureRow>(
    `
      SELECT ${SIGNATURE_COLUMNS}
      FROM crm.email_signatures
      WHERE user_id = $1::uuid AND id = $2::uuid
      LIMIT 1
    `,
    [userId, signatureId],
  );
  return result.rows[0] ?? null;
}

export async function saveUserEmailSignature(
  userId: string,
  input: {
    id?: string | null;
    name: string;
    bodyHtml: string;
    isDefault: boolean;
  },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Give this signature a name.");
  const bodyHtml = sanitizeSignatureHtml(input.bodyHtml);
  if (!bodyHtml) throw new Error("Add HTML for this signature.");
  const existing = await listUserEmailSignatures(userId);
  const isDefault = input.isDefault || existing.length === 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (isDefault) {
      await client.query(
        `
          UPDATE crm.email_signatures
          SET is_default = false, updated_at = now()
          WHERE user_id = $1::uuid AND is_default
        `,
        [userId],
      );
    }
    const row = input.id
      ? (
          await client.query<EmailSignatureRow>(
            `
              UPDATE crm.email_signatures
              SET name = $3,
                  body_html = $4,
                  is_default = $5,
                  updated_at = now()
              WHERE user_id = $1::uuid AND id = $2::uuid
              RETURNING ${SIGNATURE_COLUMNS}
            `,
            [userId, input.id, name, bodyHtml, isDefault],
          )
        ).rows[0]
      : (
          await client.query<EmailSignatureRow>(
            `
              INSERT INTO crm.email_signatures (user_id, name, body_html, is_default)
              VALUES ($1::uuid, $2, $3, $4)
              RETURNING ${SIGNATURE_COLUMNS}
            `,
            [userId, name, bodyHtml, isDefault],
          )
        ).rows[0];
    if (!row) throw new Error("Signature not found.");
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUserEmailSignature(userId: string, signatureId: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const deleted = await client.query<{ is_default: boolean }>(
      `
        DELETE FROM crm.email_signatures
        WHERE user_id = $1::uuid AND id = $2::uuid
        RETURNING is_default
      `,
      [userId, signatureId],
    );
    if (deleted.rows[0]?.is_default) {
      await client.query(
        `
          UPDATE crm.email_signatures
          SET is_default = true, updated_at = now()
          WHERE id = (
            SELECT id FROM crm.email_signatures
            WHERE user_id = $1::uuid
            ORDER BY name ASC
            LIMIT 1
          )
        `,
        [userId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
