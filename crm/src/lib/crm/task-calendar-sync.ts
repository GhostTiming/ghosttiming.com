export async function markTaskCalendarNeedsSync(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  taskId: string,
) {
  await client.query(
    `
      UPDATE crm.google_task_calendar_links
      SET sync_status = 'needs_sync', updated_at = now()
      WHERE task_id = $1::uuid AND sync_status = 'synced'
    `,
    [taskId],
  );
}
