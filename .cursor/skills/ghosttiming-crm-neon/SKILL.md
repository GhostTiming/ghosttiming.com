---
name: ghosttiming-crm-neon
description: >-
  Operate Ghost Timing CRM through Neon MCP (run_sql, schema, branches).
  Use when Claude or an agent should query or repair CRM data in Neon:
  prospects, bookings, events, catalog listings, tasks, scoring, email drafts,
  Google sync flags, pipeline stages, or crm.* / catalog.* SQL.
---

# Ghost Timing CRM via Neon MCP

Read and follow the full operator manual:

`crm/docs/claude-neon-mcp-user-guide.md`

Do not improvise against catalog `main` or the results Neon project.

## Required connection

| Field | Value |
| --- | --- |
| `project_id` | `morning-leaf-97649478` (`run-vibes-v2-catalog`) |
| `branch_id` | `br-hidden-frost-anccv165` (`dev-crm-first-working-slice`) |
| `database_name` | `neondb` |
| Do not use | Project `red-fire-92910214`; catalog branch `br-orange-band-anx0fd7i` for CRM tables |

Local and production CRM share this branch. Writes are production writes.

If `SELECT nspname FROM pg_namespace WHERE nspname = 'crm'` returns nothing, you are on the wrong branch.

## Hard rules

1. `SELECT` freely (with `LIMIT`, schema-qualified names). Never `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER` without explicit user confirmation.
2. Never autonomously call `delete_branch`, `delete_project`, `reset_from_parent`, or `restore_snapshot`. Resetting the CRM branch from `main` would wipe CRM (`main` has no `crm` schema).
3. Do not mutate `catalog.*`, `pipeline.*`, `source.*`, `neon_auth`, or Google token ciphertext columns.
4. Do not send live email or calendar invites. SQL may flag `crm.google_calendar_links.sync_status = 'needs_sync'`; do not then sync or create Google events.
5. CRM drafts live in `crm.email_drafts`, not Gmail. Do not auto-complete Email Out tasks.
6. Schema changes go through `crm/drizzle/` + `npx drizzle-kit migrate`, not Neon migration tools.
7. AI audit rows: `actor_type = 'ai'`, `actor_name = 'Claude'`.
8. Honor standing operator exceptions the user has set (do not convert Myrtle Mile; do not save Miles to Go scoring while only verifying).

## Tool choice

- CRM investigation: `run_sql` + `describe_table_schema` on the CRM branch.
- Multi-step confirmed writes: `run_sql_transaction`.
- Dangerous experiments: `create_branch` with `parent_id = br-hidden-frost-anccv165`, then run SQL there.
- Prospecting that must use app validation: HTTP API in `crm/docs/ai-api.md` — not raw SQL.
- Conversions, renewals, Gmail, calendar create/sync: CRM UI / app code, not MCP.

## First queries

```sql
SELECT pipeline, key, name, is_terminal, is_active
FROM crm.pipeline_stages
ORDER BY pipeline, sort_order;
```

Search races with the recipes in the operator manual (listing + event + prospect + booking). Always `LIMIT 50` or less until the user asks for a full dump.
