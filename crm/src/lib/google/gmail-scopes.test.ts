import { describe, expect, it } from "vitest";
import { GMAIL_SCOPE, GMAIL_SEND_SCOPE } from "./scopes";
import { hasGmailReadonlyScope, hasGmailSendScope } from "./gmail-scopes";

describe("Gmail scope grants", () => {
  it("does not treat gmail.readonly as permission to send", () => {
    expect(hasGmailSendScope(GMAIL_SCOPE)).toBe(false);
    expect(hasGmailSendScope(`${GMAIL_SCOPE} ${GMAIL_SEND_SCOPE}`)).toBe(true);
  });

  it("does not treat a generic gmail substring as send access", () => {
    expect(hasGmailSendScope("gmail calendar")).toBe(false);
    expect(hasGmailReadonlyScope("openid email gmail")).toBe(false);
    expect(hasGmailReadonlyScope(GMAIL_SCOPE)).toBe(true);
  });
});
