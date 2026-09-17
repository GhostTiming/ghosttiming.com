import { describe, expect, it } from "vitest";
import {
  buildGmailAddressQuery,
  emailsForGmailSearch,
  matchEmailsToCrm,
  parseAddressList,
  shouldLinkEmailToBooking,
  uniqueNormalizedEmails,
} from "./email-match";
import { formatGmailActivityBody, parseGmailMessage } from "./gmail-parse";

describe("Gmail address matching", () => {
  it("parses name and email pairs from header lists", () => {
    expect(
      parseAddressList(`Jane Doe <jane@example.org>, sponsorships@example.org`),
    ).toEqual([
      { email: "jane@example.org", name: "Jane Doe" },
      { email: "sponsorships@example.org", name: null },
    ]);
  });

  it("does not attach a client organization inbox to bookings unless it came in through a lead", () => {
    expect(
      shouldLinkEmailToBooking({
        email: "info@run4acause.org",
        organizationEmails: ["info@run4acause.org"],
        matchedAsPrimaryContact: true,
        matchedAsConvertedLead: false,
      }),
    ).toBe(false);
    expect(
      shouldLinkEmailToBooking({
        email: "rd@example.org",
        organizationEmails: ["info@run4acause.org"],
        matchedAsPrimaryContact: true,
        matchedAsConvertedLead: false,
      }),
    ).toBe(true);
    expect(
      shouldLinkEmailToBooking({
        email: "info@run4acause.org",
        organizationEmails: ["info@run4acause.org"],
        matchedAsPrimaryContact: false,
        matchedAsConvertedLead: true,
      }),
    ).toBe(true);
  });

  it("matches sender and recipients to CRM records without requiring a person name", () => {
    const matches = matchEmailsToCrm(
      ["sponsorships@example.org", "other@nowhere.test"],
      {
        "sponsorships@example.org": {
          prospectIds: ["11111111-1111-1111-1111-111111111111"],
          bookingIds: [],
          organizationIds: ["22222222-2222-2222-2222-222222222222"],
          personIds: [],
        },
      },
    );
    expect(matches.prospectIds).toHaveLength(1);
    expect(matches.organizationIds).toHaveLength(1);
    expect(matches.personIds).toHaveLength(0);
  });

  it("builds targeted Gmail search queries", () => {
    expect(buildGmailAddressQuery(["a@example.org", "b@example.org"])).toContain(
      "from:a@example.org OR to:a@example.org OR cc:a@example.org",
    );
    expect(buildGmailAddressQuery(["a@example.org"])).toContain("-in:spam -in:trash");
  });

  it("includes organization inboxes in Gmail search queries", () => {
    expect(
      emailsForGmailSearch({
        "info@run4acause.org": {
          prospectIds: [],
          bookingIds: [],
          organizationIds: ["22222222-2222-2222-2222-222222222222"],
          personIds: [],
        },
        "rd@example.org": {
          prospectIds: ["11111111-1111-1111-1111-111111111111"],
          bookingIds: [],
          organizationIds: [],
          personIds: ["33333333-3333-3333-3333-333333333333"],
        },
      }),
    ).toEqual(["info@run4acause.org", "rd@example.org"]);
  });

  it("dedupes emails for a targeted Gmail search", () => {
    expect(
      uniqueNormalizedEmails(
        "Jane@Example.org",
        ["jane@example.org", "rd@example.org"],
        "not-an-email",
      ),
    ).toEqual(["jane@example.org", "rd@example.org"]);
  });
});

describe("Gmail message parsing", () => {
  it("classifies outgoing mail and extracts a plain-text body", () => {
    const parsed = parseGmailMessage(
      {
        id: "abc123",
        threadId: "thread1",
        snippet: "See you Saturday",
        internalDate: "1700000000000",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "Michelle <michelle@getrunvibes.com>" },
            { name: "To", value: "sponsorships@example.org" },
            { name: "Subject", value: "Timing quote" },
            { name: "Message-ID", value: "<msg@mail.gmail.com>" },
          ],
          body: {
            data: Buffer.from("Happy to time the 5K.").toString("base64url"),
          },
        },
      },
      "michelle@getrunvibes.com",
    );
    expect(parsed).toMatchObject({
      gmailMessageId: "abc123",
      direction: "outgoing",
      fromAddress: "michelle@getrunvibes.com",
      toAddresses: ["sponsorships@example.org"],
      subject: "Timing quote",
      bodyText: "Happy to time the 5K.",
    });
    expect(formatGmailActivityBody(parsed!)).toContain("Subject: Timing quote");
  });

  it("classifies incoming mail when the connected account is a recipient", () => {
    const parsed = parseGmailMessage(
      {
        id: "def456",
        internalDate: "1700000000000",
        payload: {
          headers: [
            { name: "From", value: "sponsorships@example.org" },
            { name: "To", value: "michelle@getrunvibes.com" },
            { name: "Subject", value: "Re: Timing quote" },
          ],
        },
      },
      "michelle@getrunvibes.com",
    );
    expect(parsed?.direction).toBe("incoming");
    expect(parsed?.involvedEmails).toEqual(
      expect.arrayContaining(["sponsorships@example.org", "michelle@getrunvibes.com"]),
    );
  });
});
