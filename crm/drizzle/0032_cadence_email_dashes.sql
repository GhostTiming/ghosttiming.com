UPDATE "crm"."email_templates"
SET
  "body_html" = replace(replace("body_html", '—', '-'), '–', '-'),
  "updated_at" = now()
WHERE "kind" = 'cadence';
