export type ActivityFeedItem = {
  kind: "activity";
  id: string;
  at: string;
};

export type TaskFeedItem = {
  kind: "task";
  id: string;
  at: string;
};

export type ActivityTaskFeedItem = ActivityFeedItem | TaskFeedItem;

export function buildActivityTaskFeed(
  activities: Array<{
    id: string;
    occurred_at: string;
    metadata?: { taskId?: string } | null;
  }>,
  tasks: Array<{
    id: string;
    due_at: string;
  }>,
): ActivityTaskFeedItem[] {
  const taskIds = new Set(tasks.map((task) => task.id));
  const items: ActivityTaskFeedItem[] = [
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      at: task.due_at,
    })),
    ...activities
      .filter((activity) => {
        const taskId = activity.metadata?.taskId;
        return !taskId || !taskIds.has(taskId);
      })
      .map((activity) => ({
        kind: "activity" as const,
        id: activity.id,
        at: activity.occurred_at,
      })),
  ];
  items.sort((left, right) => {
    const delta = new Date(right.at).valueOf() - new Date(left.at).valueOf();
    if (delta !== 0) return delta;
    if (left.kind === right.kind) return left.id.localeCompare(right.id);
    return left.kind === "task" ? -1 : 1;
  });
  return items;
}
