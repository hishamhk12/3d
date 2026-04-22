import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  generateSessionToken,
  verifySessionToken,
} from "@/lib/room-preview/session-token";

// Note: SESSION_TOKEN_SECRET is set to a test value in tests/setup.ts

describe("generateSessionToken", () => {
  it("returns a non-empty string", () => {
    const token = generateSessionToken("session-1");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("is deterministic — same session id always produces the same token", () => {
    const a = generateSessionToken("session-abc");
    const b = generateSessionToken("session-abc");
    expect(a).toBe(b);
  });

  it("produces different tokens for different session ids", () => {
    const a = generateSessionToken("session-1");
    const b = generateSessionToken("session-2");
    expect(a).not.toBe(b);
  });

  it("output is base64url encoded (no +, /, or = characters)", () => {
    const token = generateSessionToken("session-test");
    expect(token).not.toMatch(/[+/=]/);
  });

  it("output is 43 characters (256-bit HMAC-SHA256 → 32 bytes → 43 base64url chars)", () => {
    const token = generateSessionToken("any-id");
    expect(token).toHaveLength(43);
  });
});

describe("verifySessionToken", () => {
  it("returns true for a valid token", () => {
    const id = "session-verify";
    const token = generateSessionToken(id);
    expect(verifySessionToken(token, id)).toBe(true);
  });

  it("returns false for a token that was generated for a different session", () => {
    const token = generateSessionToken("session-a");
    expect(verifySessionToken(token, "session-b")).toBe(false);
  });

  it("returns false for an empty token string", () => {
    expect(verifySessionToken("", "session-1")).toBe(false);
  });

  it("returns false for a tampered token (single char changed)", () => {
    const id = "session-tamper";
    const token = generateSessionToken(id);
    // Flip the last character
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifySessionToken(tampered, id)).toBe(false);
  });

  it("returns false for a completely random string", () => {
    expect(verifySessionToken("notavalidtoken", "session-1")).toBe(false);
  });
});

describe("secret isolation", () => {
  const originalSecret = process.env.SESSION_TOKEN_SECRET;

  afterEach(() => {
    process.env.SESSION_TOKEN_SECRET = originalSecret;
  });

  it("tokens generated with different secrets are not interchangeable", () => {
    process.env.SESSION_TOKEN_SECRET = "secret-one-32-bytes-exactly!!!!";
    const tokenA = generateSessionToken("session-x");

    process.env.SESSION_TOKEN_SECRET = "secret-two-32-bytes-exactly!!!!";
    const tokenB = generateSessionToken("session-x");

    expect(tokenA).not.toBe(tokenB);
  });

  it("verify returns false when the secret changes after token generation", () => {
    process.env.SESSION_TOKEN_SECRET = "original-secret-32-bytes-exactly";
    const token = generateSessionToken("session-y");

    process.env.SESSION_TOKEN_SECRET = "different-secret-32-bytes-exactly";
    expect(verifySessionToken(token, "session-y")).toBe(false);
  });
});
