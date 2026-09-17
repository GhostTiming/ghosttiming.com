import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export function googleTokenEncryptionKeyBytes(raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
  const value = raw?.trim() ?? "";
  if (!value) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Generate a 32-byte hex key and add it to the server environment.",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  const asBuffer = Buffer.from(value, "base64");
  if (asBuffer.length === KEY_BYTES) return asBuffer;
  throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes as 64 hex characters or base64.");
}

export function encryptSecret(plaintext: string, key = googleTokenEncryptionKeyBytes()) {
  if (!plaintext) throw new Error("Refusing to encrypt an empty secret.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(envelope: string, key = googleTokenEncryptionKeyBytes()) {
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("Google token envelope is not a recognized v1 ciphertext.");
  }
  const [, ivPart, tagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== 16 || !data.length) {
    throw new Error("Google token envelope is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function signOAuthState(payload: string, key = googleTokenEncryptionKeyBytes()) {
  const body = Buffer.from(payload, "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyOAuthState(token: string, key = googleTokenEncryptionKeyBytes()) {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) throw new Error("Google OAuth state cookie is invalid.");
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error("Google OAuth state cookie failed verification.");
  }
  return Buffer.from(body, "base64url").toString("utf8");
}
