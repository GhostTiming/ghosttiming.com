import { describe, expect, it } from "vitest";
import { CHIP_ROW, DESKTOP_TABLE, TABLE_SCROLL } from "./layout";

describe("crm layout tokens", () => {
  it("keeps chip rows wrapping instead of sideways scrolling", () => {
    expect(CHIP_ROW).toContain("flex-wrap");
    expect(CHIP_ROW).not.toContain("overflow-x-auto");
    expect(CHIP_ROW).not.toContain("flex-nowrap");
  });

  it("contains desktop tables and scroll regions to the viewport width", () => {
    expect(DESKTOP_TABLE).toContain("max-w-full");
    expect(TABLE_SCROLL).toContain("max-w-full");
    expect(TABLE_SCROLL).toContain("overflow-x-auto");
  });
});
