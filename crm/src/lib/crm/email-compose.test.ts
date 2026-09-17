import { describe, expect, it } from "vitest";
import {
  composeWarningForDraft,
  formatRecipientField,
  groupMessagesIntoThreads,
  parseRecipientField,
  replyRecipients,
} from "./email-compose";

describe("lead email compose helpers", () => {
  it("parses comma and semicolon recipient lists", () => {
    expect(
      parseRecipientField("Jane <jane@example.org>; board@example.org, skip"),
    ).toEqual(["jane@example.org", "board@example.org"]);
    expect(formatRecipientField(["jane@example.org", "jane@example.org"])).toBe(
      "jane@example.org",
    );
  });

  it("replies to the sender of an incoming thread and leaves the connected Gmail out", () => {
    expect(
      replyRecipients({
        connectedEmail: "michelle@getrunvibes.com",
        lastDirection: "incoming",
        fromAddress: "rd@example.org",
        toAddresses: ["michelle@getrunvibes.com", "board@example.org"],
        ccAddresses: ["cc@example.org"],
      }),
    ).toEqual({
      to: ["rd@example.org"],
      cc: ["board@example.org", "cc@example.org"],
    });
  });

  it("groups stored Gmail messages into replyable threads", () => {
    const threads = groupMessagesIntoThreads(
      [
        {
          gmail_message_id: "m1",
          gmail_thread_id: "t1",
          rfc_message_id: "<one@mail>",
          direction: "incoming",
          from_address: "rd@example.org",
          from_name: "RD",
          to_addresses: ["michelle@getrunvibes.com"],
          cc_addresses: [],
          subject: "Quote?",
          snippet: "Can you time us?",
          body_text: "Can you time us?",
          occurred_at: "2026-01-01T12:00:00.000Z",
        },
        {
          gmail_message_id: "m2",
          gmail_thread_id: "t1",
          rfc_message_id: "<two@mail>",
          direction: "outgoing",
          from_address: "michelle@getrunvibes.com",
          from_name: "Michelle",
          to_addresses: ["rd@example.org"],
          cc_addresses: [],
          subject: "Re: Quote?",
          snippet: "Yes.",
          body_text: "Yes.",
          occurred_at: "2026-01-02T12:00:00.000Z",
        },
      ],
      "michelle@getrunvibes.com",
    );
    expect(threads).toHaveLength(1);
    expect(threads[0].replyTo).toEqual(["rd@example.org"]);
    expect(threads[0].lastRfcMessageId).toBe("<two@mail>");
  });

  it("warns on Do Not Contact drafts but still allows saving", () => {
    expect(
      composeWarningForDraft({
        doNotContact: true,
        toAddresses: ["rd@example.org"],
      }),
    ).toMatch(/Do Not Contact/);
    expect(
      composeWarningForDraft({
        doNotContact: false,
        toAddresses: [],
      }),
    ).toMatch(/recipient/);
  });
});
