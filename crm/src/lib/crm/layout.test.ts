import { describe, expect, it } from "vitest";
import { DESKTOP_TABLE, TABLE_SCROLL } from "./layout";

describe("CRM layout classes", () => {
  it("keeps wide tables inside the card on phones", () => {
    expect(TABLE_SCROLL).toContain("overflow-x-auto");
    expect(TABLE_SCROLL).toContain("max-w-full");
    expect(DESKTOP_TABLE).toContain("max-w-full");
  });
});
