import { describe, expect, it } from "vitest";
import {
  matchesPersonNameQuery,
  personEmailMatchesSql,
  personNameMatchesSql,
  splitPersonSearchTokens,
} from "./person-search";

describe("person name search", () => {
  const seth = {
    firstName: "Seth",
    lastName: "Doe",
    email: "seth@example.com",
  };

  it("matches first and last together when display_name is empty", () => {
    expect(matchesPersonNameQuery(seth, "Seth Doe")).toBe(true);
    expect(matchesPersonNameQuery(seth, "seth doe")).toBe(true);
    expect(matchesPersonNameQuery(seth, "Doe Seth")).toBe(true);
  });

  it("still matches a single first or last name", () => {
    expect(matchesPersonNameQuery(seth, "Seth")).toBe(true);
    expect(matchesPersonNameQuery(seth, "doe")).toBe(true);
  });

  it("does not match an unrelated two-word query", () => {
    expect(matchesPersonNameQuery(seth, "Jordan Lee")).toBe(false);
    expect(matchesPersonNameQuery(seth, "")).toBe(false);
  });

  it("splits a typed full name into first and last tokens", () => {
    expect(splitPersonSearchTokens("  Seth   Doe ")).toEqual(["Seth", "Doe"]);
  });

  it("builds SQL that searches concatenated first and last names", () => {
    const sql = personNameMatchesSql("$4", { includePhone: true });
    expect(sql).toContain("concat_ws(' ', person.first_name, person.last_name)");
    expect(sql).toContain("concat_ws(' ', person.last_name, person.first_name)");
    expect(sql).toContain("regexp_split_to_array");
    expect(sql).toContain("person.email");
    expect(sql).toContain("person.phone");
  });

  it("builds escaped SQL that matches a linked contact email", () => {
    const sql = personEmailMatchesSql("$1", { escape: true });
    expect(sql).toContain("person.email");
    expect(sql).toContain("$1");
    expect(sql).toContain("ESCAPE '\\'");
  });
});
