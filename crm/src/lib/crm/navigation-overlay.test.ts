import { describe, expect, it } from "vitest";
import { formSubmitLeavesCurrentPage } from "./navigation-overlay";

const location = {
  origin: "http://localhost:3001",
  pathname: "/bookings/abc",
  search: "",
};

function form(method: string, action: string | null) {
  return {
    method,
    getAttribute(name: string) {
      return name === "action" ? action : null;
    },
  };
}

describe("formSubmitLeavesCurrentPage", () => {
  it("ignores same-page server actions so saves do not lock the UI", () => {
    expect(formSubmitLeavesCurrentPage(form("post", ""), location)).toBe(false);
    expect(formSubmitLeavesCurrentPage(form("post", null), location)).toBe(false);
    expect(
      formSubmitLeavesCurrentPage(form("post", "/bookings/abc"), location),
    ).toBe(false);
  });

  it("tracks submits that actually leave the current page", () => {
    expect(
      formSubmitLeavesCurrentPage(form("post", "/bookings/new"), location),
    ).toBe(true);
    expect(
      formSubmitLeavesCurrentPage(
        form("post", "/bookings/abc?edit=1"),
        location,
      ),
    ).toBe(true);
  });

  it("ignores dialogs and off-site posts", () => {
    expect(formSubmitLeavesCurrentPage(form("dialog", "/x"), location)).toBe(
      false,
    );
    expect(
      formSubmitLeavesCurrentPage(
        form("post", "https://example.com/x"),
        location,
      ),
    ).toBe(false);
  });
});
