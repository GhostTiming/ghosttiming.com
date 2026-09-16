import { describe, expect, it } from "vitest";
import {
  extractContacts,
  normalizeEmail,
  normalizePhone,
} from "./extract";

describe("browser contact extraction", () => {
  it("extracts and labels emails from visible text and mailto links", () => {
    const contacts = extractContacts(`
      <p>Race Director: Jane Doe</p>
      <a href="mailto:Jane.Doe@Example.org">Jane.Doe@Example.org</a>
    `);
    expect(contacts).toContainEqual({
      type: "email",
      rawValue: "Jane.Doe@Example.org",
      normalizedValue: "jane.doe@example.org",
      label: "Race Director",
      sourceField: "description_html",
    });
    expect(contacts.filter((contact) => contact.type === "email")).toHaveLength(1);
  });

  it("decodes common HTML entities in email addresses", () => {
    expect(extractContacts("<p>Contact: timing&#64;example&#46;com</p>")).toEqual([
      {
        type: "email",
        rawValue: "timing@example.com",
        normalizedValue: "timing@example.com",
        label: "Contact",
        sourceField: "description_html",
      },
    ]);
  });

  it("normalizes common US phone formats and deduplicates them", () => {
    const contacts = extractContacts(`
      <p>Race Director phone: (919) 555-1212</p>
      <a href="tel:9195551212">919.555.1212</a>
    `);
    expect(contacts.filter((contact) => contact.type === "phone")).toEqual([
      {
        type: "phone",
        rawValue: "(919) 555-1212",
        normalizedValue: "+19195551212",
        label: "Race Director",
        sourceField: "description_html",
      },
    ]);
  });

  it("ignores dates and short number strings", () => {
    expect(extractContacts("<p>Race date: 09/15/2026. ID 123456.</p>")).toEqual([]);
  });

  it("normalizes server-compatible values", () => {
    expect(normalizeEmail("Info@Example.COM.")).toBe("info@example.com");
    expect(normalizePhone("1-919-555-1212")).toBe("+19195551212");
  });
});
