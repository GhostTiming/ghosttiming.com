import { afterEach, describe, expect, it } from "vitest";
import { authenticateAiRequest } from "./ai";

const originalKey = process.env.CRM_AI_API_KEY;
const originalActor = process.env.CRM_AI_ACTOR_NAME;

afterEach(() => {
  process.env.CRM_AI_API_KEY = originalKey;
  process.env.CRM_AI_ACTOR_NAME = originalActor;
});

describe("AI bearer authentication", () => {
  it("rejects missing and incorrect credentials", () => {
    process.env.CRM_AI_API_KEY = "a".repeat(64);
    expect(authenticateAiRequest(new Request("http://crm.test"))).toBeNull();
    expect(
      authenticateAiRequest(
        new Request("http://crm.test", {
          headers: { Authorization: `Bearer ${"b".repeat(64)}` },
        }),
      ),
    ).toBeNull();
  });

  it("accepts the configured key and returns fixed actor metadata", () => {
    process.env.CRM_AI_API_KEY = "a".repeat(64);
    process.env.CRM_AI_ACTOR_NAME = "Claude";
    expect(
      authenticateAiRequest(
        new Request("http://crm.test", {
          headers: { Authorization: `Bearer ${"a".repeat(64)}` },
        }),
      ),
    ).toEqual({ actorType: "ai", actorName: "Claude" });
  });

  it("fails closed when the configured key is too short", () => {
    process.env.CRM_AI_API_KEY = "short";
    expect(
      authenticateAiRequest(
        new Request("http://crm.test", {
          headers: { Authorization: "Bearer short" },
        }),
      ),
    ).toBeNull();
  });
});
