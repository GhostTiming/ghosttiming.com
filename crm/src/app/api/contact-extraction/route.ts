import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import {
  CONTACT_EXTRACTION_BATCH_SIZE,
  CONTACT_PARSER_VERSION,
} from "@/lib/contact-extraction/constants";

const contactSchema = z.object({
  type: z.enum(["email", "phone"]),
  rawValue: z.string().trim().min(1).max(320),
  normalizedValue: z.string().trim().min(1).max(320),
  label: z.string().trim().max(120).optional(),
  sourceField: z.string().trim().max(80).default("description_html"),
});

const payloadSchema = z.object({
  records: z
    .array(
      z.object({
        raceListingId: z.string().min(1).max(200),
        sourceHash: z.string().min(1).max(200),
        contacts: z.array(contactSchema).max(50),
      }),
    )
    .min(1)
    .max(CONTACT_EXTRACTION_BATCH_SIZE),
});

function normalizeContact(type: "email" | "phone", value: string) {
  if (type === "email") {
    return value
      .replace(/^mailto:/i, "")
      .trim()
      .replace(/[),.;:]+$/g, "")
      .toLowerCase();
  }
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export async function POST(request: Request) {
  await requireProspectingUser();
  const payload = payloadSchema.parse(await request.json());
  const client = await getPool().connect();
  let savedContacts = 0;

  try {
    await client.query("BEGIN");
    for (const record of payload.records) {
      const current = await client.query<{
        source_hash: string;
        prospect_id: string | null;
      }>(
        `
          SELECT
            COALESCE(
              max(tag.source_content_hash) FILTER (WHERE tag.source_content_hash IS NOT NULL),
              md5(COALESCE(rl.description_html, ''))
            ) AS source_hash,
            (
              SELECT p.id::text
              FROM crm.prospects p
              WHERE p.race_listing_id = rl.id
              ORDER BY p.created_at DESC
              LIMIT 1
            ) AS prospect_id
          FROM catalog.race_listings rl
          JOIN catalog.race_listing_regex_tags tag
            ON tag.race_listing_id = rl.id
           AND tag.tag_namespace = 'lead_contact'
           AND tag.tag_key IN ('description_has_email', 'description_has_phone')
           AND tag.tag_value = 'true'
          WHERE rl.id = $1
          GROUP BY rl.id, rl.description_html
        `,
        [record.raceListingId],
      );
      if (!current.rows[0]) {
        throw new Error(`Race listing ${record.raceListingId} is no longer eligible.`);
      }
      if (current.rows[0].source_hash !== record.sourceHash) {
        throw new Error(`Race listing ${record.raceListingId} changed during extraction.`);
      }

      await client.query(
        `
          UPDATE crm.contact_methods
          SET status = 'invalid', updated_at = now()
          WHERE race_listing_id = $1
            AND source = 'extracted'
        `,
        [record.raceListingId],
      );

      const primarySeen = new Set<string>();
      for (const contact of record.contacts) {
        const normalizedValue = normalizeContact(
          contact.type,
          contact.normalizedValue,
        );
        const digitCount =
          contact.type === "phone" ? normalizedValue.replace(/\D/g, "").length : 0;
        const status =
          contact.type === "email"
            ? normalizedValue.includes("@")
              ? "valid"
              : "invalid"
            : digitCount >= 7 && digitCount <= 15
              ? "valid"
              : "invalid";
        const isPrimary = !primarySeen.has(contact.type) && status === "valid";
        if (isPrimary) primarySeen.add(contact.type);

        await client.query(
          `
            INSERT INTO crm.contact_methods (
              prospect_id,
              race_listing_id,
              type,
              raw_value,
              normalized_value,
              label,
              source,
              source_field,
              source_content_hash,
              is_primary,
              status
            )
            VALUES (
              $1::uuid,
              $2,
              $3::crm.contact_method_type,
              $4,
              $5,
              $6,
              'extracted',
              $7,
              $8,
              $9,
              $10::crm.contact_method_status
            )
            ON CONFLICT (race_listing_id, type, normalized_value)
            DO UPDATE SET
              prospect_id = COALESCE(crm.contact_methods.prospect_id, EXCLUDED.prospect_id),
              raw_value = EXCLUDED.raw_value,
              label = COALESCE(EXCLUDED.label, crm.contact_methods.label),
              source_content_hash = EXCLUDED.source_content_hash,
              is_primary = EXCLUDED.is_primary,
              status = EXCLUDED.status,
              updated_at = now()
          `,
          [
            current.rows[0].prospect_id,
            record.raceListingId,
            contact.type,
            contact.rawValue,
            normalizedValue,
            contact.label ?? null,
            contact.sourceField,
            record.sourceHash,
            isPrimary,
            status,
          ],
        );
        savedContacts += 1;
      }

      await client.query(
        `
          INSERT INTO crm.contact_extraction_state (
            race_listing_id,
            source_content_hash,
            parser_version,
            status,
            extracted_count,
            processed_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'processed', $4, now(), now())
          ON CONFLICT (race_listing_id)
          DO UPDATE SET
            source_content_hash = EXCLUDED.source_content_hash,
            parser_version = EXCLUDED.parser_version,
            status = 'processed',
            extracted_count = EXCLUDED.extracted_count,
            error_message = NULL,
            processed_at = now(),
            updated_at = now()
        `,
        [
          record.raceListingId,
          record.sourceHash,
          CONTACT_PARSER_VERSION,
          record.contacts.length,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  revalidatePath("/prospecting");
  return Response.json({
    processed: payload.records.length,
    savedContacts,
  });
}
