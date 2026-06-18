import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  passwordByteLength,
  isPasswordWithinByteLimit,
  MAX_PASSWORD_BYTES,
} from "@/lib/seller/password";

describe("seller password hashing (UTF-8 byte limits)", () => {
  it("hashes and verifies a correct ASCII password", async () => {
    const hash = await hashPassword("correct horse 8");
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse 8", hash)).toBe(true);
    expect(await verifyPassword("wrong password!", hash)).toBe(false);
  });

  it("counts UTF-8 bytes, not characters (Arabic is multi-byte)", () => {
    // Arabic letters are 2 bytes each in UTF-8.
    expect(passwordByteLength("ABCD")).toBe(4);
    expect(passwordByteLength("كلمه")).toBe(8); // 4 chars × 2 bytes
    // A 4-byte emoji.
    expect(passwordByteLength("😀")).toBe(4);
  });

  it("accepts an Arabic password exactly at the 72-byte boundary", async () => {
    const pw = "ك".repeat(36); // 36 × 2 = 72 bytes
    expect(passwordByteLength(pw)).toBe(MAX_PASSWORD_BYTES);
    expect(isPasswordWithinByteLimit(pw)).toBe(true);
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
  });

  it("rejects an Arabic password just over the 72-byte boundary (no truncation)", async () => {
    const pw = "ك".repeat(37); // 74 bytes
    expect(passwordByteLength(pw)).toBe(74);
    expect(isPasswordWithinByteLimit(pw)).toBe(false);
    await expect(hashPassword(pw)).rejects.toThrow(/72-byte/);
  });

  it("rejects an over-limit password at verify time rather than truncating", async () => {
    const within = "ك".repeat(36); // 72 bytes, valid
    const hash = await hashPassword(within);
    const over = within + "كك"; // 76 bytes
    // Without byte-guarding, bcrypt would truncate `over` to 72 bytes and match.
    expect(await verifyPassword(over, hash)).toBe(false);
  });

  it("handles multibyte emoji near the boundary", async () => {
    const pw = "😀".repeat(18); // 18 × 4 = 72 bytes
    expect(passwordByteLength(pw)).toBe(72);
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
    expect(await verifyPassword("😀".repeat(19), hash)).toBe(false); // 76 bytes
  });
});
