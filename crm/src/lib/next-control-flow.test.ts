import { describe, expect, it } from "vitest";
import {
  actionFailureResult,
  isNextControlFlowError,
  rethrowNextControlFlow,
} from "./next-control-flow";

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

  it("maps ordinary errors to action results without swallowing redirects", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/bookings/abc",
    });
    expect(() => actionFailureResult(redirect)).toThrow(redirect);
    expect(actionFailureResult(new Error("Complete prep first."))).toEqual({
      ok: false,
      message: "Complete prep first.",
    });
    expect(actionFailureResult("nope", "Could not save stage.")).toEqual({
      ok: false,
      message: "Could not save stage.",
    });
  });
});
