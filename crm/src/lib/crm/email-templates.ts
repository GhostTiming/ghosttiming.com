import { getPool } from "@/db";
import {
  DEFAULT_CREW_EMAIL_HTML,
  DEFAULT_CREW_EMAIL_NAME,
  DEFAULT_CREW_EMAIL_SUBJECT,
} from "@/lib/crm/crew-email";

export type EmailTemplateRow = {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  kind: string;
  updated_at: string;
};

export type EmailTemplateSummary = {
  id: string;
  name: string;
  kind: string;
};

const TEMPLATE_COLUMNS = `
  id::text,
  name,
  subject,
  body_html,
  kind,
  updated_at::text
`;

export async function ensureUserCrewTemplates(userId: string) {
  await getPool().query(
    `
      INSERT INTO crm.email_templates (user_id, name, subject, body_html, kind)
      SELECT $1::uuid, $2, $3, $4, 'crew'
      WHERE NOT EXISTS (
        SELECT 1 FROM crm.email_templates WHERE user_id = $1::uuid
      )
      ON CONFLICT (user_id, name) DO NOTHING
    `,
    [userId, DEFAULT_CREW_EMAIL_NAME, DEFAULT_CREW_EMAIL_SUBJECT, DEFAULT_CREW_EMAIL_HTML],
  );
  await getPool().query(
    `
      UPDATE crm.email_templates
      SET subject = $3,
          body_html = $4,
          updated_at = now()
      WHERE user_id = $1::uuid
        AND name = $2
        AND body_html LIKE '%Event and Point Name to Program%'
    `,
    [userId, DEFAULT_CREW_EMAIL_NAME, DEFAULT_CREW_EMAIL_SUBJECT, DEFAULT_CREW_EMAIL_HTML],
  );
}

export async function listUserEmailTemplates(userId: string) {
  await ensureUserCrewTemplates(userId);
  const result = await getPool().query<EmailTemplateRow>(
    `
      SELECT ${TEMPLATE_COLUMNS}
      FROM crm.email_templates
      WHERE user_id = $1::uuid
        AND kind IS DISTINCT FROM 'cadence'
      ORDER BY name ASC
    `,
    [userId],
  );
  return result.rows;
}

export async function getUserEmailTemplate(userId: string, templateId: string) {
  const result = await getPool().query<EmailTemplateRow>(
    `
      SELECT ${TEMPLATE_COLUMNS}
      FROM crm.email_templates
      WHERE user_id = $1::uuid AND id = $2::uuid
      LIMIT 1
    `,
    [userId, templateId],
  );
  return result.rows[0] ?? null;
}

export async function saveUserEmailTemplate(
  userId: string,
  input: {
    id?: string | null;
    name: string;
    subject: string;
    bodyHtml: string;
    kind?: string;
  },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Give this template a name.");
  const kind = (input.kind?.trim() || "crew").slice(0, 40);
  if (input.id) {
    const updated = await getPool().query<EmailTemplateRow>(
      `
        UPDATE crm.email_templates
        SET name = $3,
            subject = $4,
            body_html = $5,
            kind = $6,
            updated_at = now()
        WHERE user_id = $1::uuid AND id = $2::uuid
        RETURNING ${TEMPLATE_COLUMNS}
      `,
      [userId, input.id, name, input.subject, input.bodyHtml, kind],
    );
    const row = updated.rows[0];
    if (!row) throw new Error("Template not found.");
    return row;
  }
  const created = await getPool().query<EmailTemplateRow>(
    `
      INSERT INTO crm.email_templates (user_id, name, subject, body_html, kind)
      VALUES ($1::uuid, $2, $3, $4, $5)
      RETURNING ${TEMPLATE_COLUMNS}
    `,
    [userId, name, input.subject, input.bodyHtml, kind],
  );
  return created.rows[0];
}

export async function deleteUserEmailTemplate(userId: string, templateId: string) {
  await getPool().query(
    `
      DELETE FROM crm.email_templates
      WHERE user_id = $1::uuid AND id = $2::uuid
    `,
    [userId, templateId],
  );
}

export async function restoreDefaultCrewEmailTemplate(userId: string) {
  const result = await getPool().query<EmailTemplateRow>(
    `
      INSERT INTO crm.email_templates (user_id, name, subject, body_html, kind)
      VALUES ($1::uuid, $2, $3, $4, 'crew')
      ON CONFLICT (user_id, name) DO UPDATE SET
        subject = EXCLUDED.subject,
        body_html = EXCLUDED.body_html,
        kind = 'crew',
        updated_at = now()
      RETURNING ${TEMPLATE_COLUMNS}
    `,
    [userId, DEFAULT_CREW_EMAIL_NAME, DEFAULT_CREW_EMAIL_SUBJECT, DEFAULT_CREW_EMAIL_HTML],
  );
  return result.rows[0];
}

export function asTemplateSummaries(rows: EmailTemplateRow[]): EmailTemplateSummary[] {
  return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind }));
}
