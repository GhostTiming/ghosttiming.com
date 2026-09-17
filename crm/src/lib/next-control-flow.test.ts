import { describe, expect, it } from "vitest";
import {
  isNextControlFlowError,
  rethrowIfNextControlFlow,
} from "./next-control-flow";

describe("next control flow errors", () => {
  it("detects NEXT_REDIRECT digests", () => {
    expect(
      isNextControlFlowError(
        Object.assign(new Error("NEXT_REDIRECT"), {
          digest: "NEXT_REDIRECT;replace;/bookings/1;303;",
        }),
      ),
    ).toBe(true);
  });

  it("ignores ordinary errors", () => {
    expect(isNextControlFlowError(new Error("boom"))).toBe(false);
    expect(isNextControlFlowError("NEXT_REDIRECT")).toBe(false);
  });

  it("rethrows redirect errors", () => {
    const error = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/bookings/1;303;",
    });
    expect(() => rethrowIfNextControlFlow(error)).toThrow(error);
  });
});
