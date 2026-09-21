import { describe, expect, it } from "vitest";
import {
  applyColumnFilters,
  isFilterActive,
  type TableFilterField,
} from "./table-column-filter";

const fields: TableFilterField[] = [
  { type: "text", name: "q", label: "Name" },
  { type: "select", name: "email", options: [{ value: "all", label: "Any" }] },
  { type: "date-range", fromName: "dateFrom", toName: "dateTo" },
];

describe("column filters", () => {
  it("treats a name query as an active filter", () => {
    expect(isFilterActive({ q: "Seth Doe", email: "all" }, fields)).toBe(true);
    expect(isFilterActive({ email: "all" }, fields)).toBe(false);
  });

  it("keeps other list params when applying mobile filters", () => {
    expect(
      applyColumnFilters({
        pathname: "/contacts",
        params: { view: "direct_clients", q: "old", email: "has", direction: "asc" },
        fields,
        formValues: { q: "Seth Doe", email: "all", dateFrom: "", dateTo: "" },
      }),
    ).toBe("/contacts?view=direct_clients&q=Seth+Doe");
  });
});
