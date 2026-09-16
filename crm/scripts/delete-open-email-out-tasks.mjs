import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const emailOutTitleSql = `
  title = 'email_out'
  OR lower(btrim(title)) IN ('email_out', 'email', 'email out')
`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");

  const today = await client.query(`
    SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS today_ny
  `);
  const todayNy = today.rows[0].today_ny;

  const matching = await client.query(`
    SELECT
      t.id::text,
      t.title,
      t.status,
      t.due_at::text,
      (t.due_at AT TIME ZONE 'America/New_York')::date::text AS due_date_ny,
      CASE
        WHEN (t.due_at AT TIME ZONE 'America/New_York')::date = $1::date
          THEN 'today'
        ELSE 'upcoming'
      END AS bucket,
      u.name AS assignee_name
    FROM crm.tasks t
    JOIN crm.users u ON u.id = t.assigned_user_id
    WHERE t.status = 'open'
      AND (t.due_at AT TIME ZONE 'America/New_York')::date >= $1::date
      AND (${emailOutTitleSql})
    ORDER BY t.due_at, u.name
  `, [todayNy]);

  const overdueSkipped = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM crm.tasks
    WHERE status = 'open'
      AND (due_at AT TIME ZONE 'America/New_York')::date < $1::date
      AND (${emailOutTitleSql})
  `, [todayNy]);

  const ids = matching.rows.map((row) => row.id);
  const deleted = ids.length
    ? await client.query(
        `DELETE FROM crm.tasks WHERE id = ANY($1::uuid[]) RETURNING id::text`,
        [ids],
      )
    : { rowCount: 0, rows: [] };

  await client.query("COMMIT");

  const byAssignee = {};
  let dueToday = 0;
  let upcoming = 0;
  for (const row of matching.rows) {
    byAssignee[row.assignee_name] = (byAssignee[row.assignee_name] ?? 0) + 1;
    if (row.bucket === "today") dueToday += 1;
    else upcoming += 1;
  }

  console.log(
    JSON.stringify(
      {
        todayNy,
        deleted: deleted.rowCount ?? 0,
        dueToday,
        upcoming,
        overdueSkipped: overdueSkipped.rows[0].count,
        byAssignee,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
