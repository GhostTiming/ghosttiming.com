import { describe, expect, it } from "vitest";
import { buildActivityTaskFeed } from "./activity-feed";

describe("buildActivityTaskFeed", () => {
  it("mixes tasks and activities by date, newest first", () => {
    const feed = buildActivityTaskFeed(
      [
        {
          id: "a-old",
          occurred_at: "2026-09-10T15:00:00.000Z",
          metadata: null,
        },
        {
          id: "a-shadow",
          occurred_at: "2026-09-12T18:00:00.000Z",
          metadata: { taskId: "t1" },
        },
        {
          id: "a-new",
          occurred_at: "2026-09-12T15:00:00.000Z",
          metadata: null,
        },
      ],
      [{ id: "t1", due_at: "2026-09-11T04:00:00.000Z" }],
    );
    expect(feed.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "activity:a-new",
      "task:t1",
      "activity:a-old",
    ]);
  });

  it("keeps a task-linked activity when that task is gone", () => {
    const feed = buildActivityTaskFeed(
      [
        {
          id: "a2",
          occurred_at: "2026-09-12T15:00:00.000Z",
          metadata: { taskId: "missing" },
        },
      ],
      [],
    );
    expect(feed).toEqual([
      { kind: "activity", id: "a2", at: "2026-09-12T15:00:00.000Z" },
    ]);
  });
});
