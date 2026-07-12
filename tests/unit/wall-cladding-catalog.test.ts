import { describe, expect, it } from "vitest";
import {
  getWallCladdingAvailability,
  isAllowedWallCladdingSku,
  listAllowedWallCladdingSkus,
} from "@/lib/room-preview/wall-cladding-catalog";
import wallCladdingAllowlist from "@/data/room-preview/wall-cladding-sku-allowlist.json";

describe("wall-cladding-catalog (central allowlist)", () => {
  it("lists exactly the codes in the central JSON allowlist — single source of truth", () => {
    const listed = listAllowedWallCladdingSkus().sort();
    const jsonCodes = Object.keys(wallCladdingAllowlist).sort();
    expect(listed).toEqual(jsonCodes);
  });

  it("isAllowedWallCladdingSku accepts every allowlisted code", () => {
    for (const code of Object.keys(wallCladdingAllowlist)) {
      expect(isAllowedWallCladdingSku(code)).toBe(true);
    }
  });

  it("isAllowedWallCladdingSku rejects a code not on the allowlist, even with a matching family prefix", () => {
    expect(isAllowedWallCladdingSku("PWM99.999")).toBe(false);
    expect(isAllowedWallCladdingSku("MDF999.999")).toBe(false);
  });

  it("lookups are case-insensitive and trim whitespace", () => {
    expect(isAllowedWallCladdingSku("pwm02.020")).toBe(true);
    expect(isAllowedWallCladdingSku("  PWM02.020  ")).toBe(true);
  });

  it("getWallCladdingAvailability returns the correct regular/clearance value", () => {
    expect(getWallCladdingAvailability("PWM02.020")).toBe("regular");
    expect(getWallCladdingAvailability("MDF125.001")).toBe("clearance");
  });

  it("getWallCladdingAvailability returns null for a non-allowlisted code", () => {
    expect(getWallCladdingAvailability("PWM99.999")).toBeNull();
  });

  it("has no duplicate codes in the allowlist", () => {
    const codes = Object.keys(wallCladdingAllowlist);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every allowlist value is exactly \"regular\" or \"clearance\"", () => {
    for (const value of Object.values(wallCladdingAllowlist)) {
      expect(["regular", "clearance"]).toContain(value);
    }
  });
});
