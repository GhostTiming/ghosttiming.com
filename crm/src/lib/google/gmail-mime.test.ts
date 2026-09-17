import { describe, expect, it } from "vitest";
import {
  buildGmailMime,
  encodeGmailRaw,
  replySubject,
  wrapRfcMessageId,
} from "./gmail-mime";

describe("Gmail MIME", () => {
  it("builds a new message and a threaded reply with RFC headers", () => {
    const fresh = buildGmailMime({
      from: "michelle@getrunvibes.com",
      to: ["rd@example.org"],
      subject: "Timing quote",
      body: "Hi there,\n\nWe can time this race.",
    });
    expect(fresh).toContain("To: rd@example.org");
    expect(fresh).not.toContain("In-Reply-To:");

    const reply = buildGmailMime({
      from: "michelle@getrunvibes.com",
      to: ["rd@example.org"],
      cc: ["board@example.org"],
      subject: replySubject("Timing quote"),
      body: "Following up.",
      inReplyTo: "abc@mail.gmail.com",
      references: "<first@mail.gmail.com> abc@mail.gmail.com",
    });
    expect(reply).toContain("Subject: Re: Timing quote");
    expect(reply).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(reply).toContain("References: <first@mail.gmail.com> <abc@mail.gmail.com>");
    expect(wrapRfcMessageId("<already@id>")).toBe("<already@id>");
    expect(encodeGmailRaw(reply)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeGmailRaw("hello")).toBe("aGVsbG8");
    expect(encodeGmailRaw("subjects+/=")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not double the Re: prefix", () => {
    expect(replySubject("Re: Timing quote")).toBe("Re: Timing quote");
  });
});
