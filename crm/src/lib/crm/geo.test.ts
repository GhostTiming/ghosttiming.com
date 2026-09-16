import { describe, expect, it } from "vitest";
import { normalizeZip } from "./geo";

describe("normalizeZip", () => {
  it("keeps the first five digits", () => {
    expect(normalizeZip("27514")).toBe("27514");
    expect(normalizeZip("27514-1234")).toBe("27514");
    expect(normalizeZip("  27514  ")).toBe("27514");
  });

  it("rejects incomplete ZIP codes", () => {
    expect(normalizeZip("2751")).toBe("");
    expect(normalizeZip("")).toBe("");
    expect(normalizeZip(null)).toBe("");
  });
});
