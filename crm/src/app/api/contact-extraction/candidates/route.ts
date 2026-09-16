import { NextRequest } from "next/server";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import { CONTACT_PARSER_VERSION } from "@/lib/contact-extraction/constants";

type CandidateRow = {
  race_listing_id: string;
  race_name: string;
  description_html: string;
  source_hash: string;
  total_count: number;
};

export async function GET(request: NextRequest) {
  await requireProspectingUser();
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit) || 50));
  const result = await getPool().query<CandidateRow>(
    `
      WITH eligible AS (
        SELECT
          rl.id AS race_listing_id,
          rl.name AS race_name,
          rl.description_html,
          COALESCE(
            max(tag.source_content_hash) FILTER (WHERE tag.source_content_hash IS NOT NULL),
            md5(COALESCE(rl.description_html, ''))
          ) AS source_hash
        FROM catalog.race_listings rl
        JOIN catalog.race_listing_regex_tags tag
          ON tag.race_listing_id = rl.id
         AND tag.tag_namespace = 'lead_contact'
         AND tag.tag_key IN ('description_has_email', 'description_has_phone')
         AND tag.tag_value = 'true'
        WHERE rl.next_start_at >= now()
          AND rl.description_html IS NOT NULL
          AND rl.description_html <> ''
        GROUP BY rl.id, rl.name, rl.description_html
      ),
      pending AS (
        SELECT eligible.*, count(*) OVER ()::integer AS total_count
        FROM eligible
        LEFT JOIN crm.contact_extraction_state state
          ON state.race_listing_id = eligible.race_listing_id
        WHERE state.race_listing_id IS NULL
           OR state.source_content_hash <> eligible.source_hash
           OR state.parser_version <> $2
           OR state.status = 'failed'
      )
      SELECT race_listing_id, race_name, description_html, source_hash, total_count
      FROM pending
      ORDER BY race_listing_id
      LIMIT $1
    `,
    [limit, CONTACT_PARSER_VERSION],
  );

  return Response.json(
    {
      total: result.rows[0]?.total_count ?? 0,
      records: result.rows.map((row) => ({
        race_listing_id: row.race_listing_id,
        race_name: row.race_name,
        description_html: row.description_html,
        source_hash: row.source_hash,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
