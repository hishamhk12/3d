import { describe, it, expect } from "vitest";
import {
  normalizeCode,
  normalizeSellerCode,
  normalizeShowroomCode,
  isValidCode,
} from "@/lib/seller/codes";

describe("seller code normalization", () => {
  it("trims surrounding whitespace and uppercases", () => {
    expect(normalizeCode("  s001 ")).toBe("S001");
    expect(normalizeCode("riyadh")).toBe("RIYADH");
  });

  it("treats case + whitespace variants as the same canonical code", () => {
    const variants = ["abc123", " ABC123 ", "Abc123", "aBc123\t"];
    const canonical = variants.map(normalizeCode);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("ABC123");
  });

  it("exposes seller/showroom aliases with identical behavior", () => {
    expect(normalizeSellerCode(" slr-9 ")).toBe("SLR-9");
    expect(normalizeShowroomCode(" shw-9 ")).toBe("SHW-9");
  });

  it("preserves internal code punctuation used by real codes", () => {
    expect(normalizeCode(" pqc301-1220x180x6 ")).toBe("PQC301-1220X180X6");
  });

  it("rejects empty and whitespace-containing codes", () => {
    expect(isValidCode("   ")).toBe(false);
    expect(isValidCode("a b")).toBe(false);
    expect(isValidCode(" S001 ")).toBe(true);
  });
});
