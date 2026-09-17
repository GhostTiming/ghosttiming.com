import { describe, expect, it } from "vitest";
import { isNextControlFlowError, rethrowNextControlFlow } from "./next-control-flow";

describe("Next control-flow errors", () => {
  it("recognizes redirect and not-found digests", () => {
    expect(
      isNextControlFlowError({ digest: "NEXT_REDIRECT;replace;/bookings/abc" }),
    ).toBe(true);
    expect(isNextControlFlowError({ digest: "NEXT_NOT_FOUND" })).toBe(true);
    expect(isNextControlFlowError(new Error("NEXT_REDIRECT"))).toBe(false);
  });

  it("rethrows control-flow errors so the navigation can finish", () => {
    const error = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/bookings/abc",
    });
    expect(() => rethrowNextControlFlow(error)).toThrow(error);
    expect(() => rethrowNextControlFlow(new Error("Could not save stage."))).not.toThrow();
  });
});
