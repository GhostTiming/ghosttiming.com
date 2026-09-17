import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  googleTokenEncryptionKeyBytes,
  signOAuthState,
  verifyOAuthState,
} from "./token-crypto";

const TEST_KEY = "a".repeat(64);

describe("Google token encryption", () => {
  afterEach(() => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  });

  it("round-trips a refresh token and never stores plaintext in the envelope", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const secret = "1//refresh-token-value";
    const envelope = encryptSecret(secret);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope).not.toContain(secret);
    expect(decryptSecret(envelope)).toBe(secret);
  });

  it("rejects a tampered envelope", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const envelope = encryptSecret("keep-me");
    const broken = `${envelope.slice(0, -2)}aa`;
    expect(() => decryptSecret(broken)).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => googleTokenEncryptionKeyBytes("")).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
    expect(() => googleTokenEncryptionKeyBytes("short")).toThrow(/32 bytes/);
    expect(googleTokenEncryptionKeyBytes(TEST_KEY)).toHaveLength(32);
  });

  it("signs and verifies OAuth state", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const token = signOAuthState(JSON.stringify({ state: "abc" }));
    expect(JSON.parse(verifyOAuthState(token))).toEqual({ state: "abc" });
    expect(() => verifyOAuthState(`${token}x`)).toThrow(/verification/);
  });
});
