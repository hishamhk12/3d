import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma";
import { resolveSellerAccess } from "@/lib/seller/account-access";

type SellerRow = {
  id: string;
  name: string;
  sellerCode: string;
  status: "active" | "disabled";
  tokenVersion: number;
  showroom: { id: string; code: string } | null;
};

function dbReturning(row: SellerRow | null): PrismaClient {
  return {
    seller: { findUnique: vi.fn().mockResolvedValue(row) },
  } as unknown as PrismaClient;
}

const activeRow: SellerRow = {
  id: "s1",
  name: "بائع",
  sellerCode: "S001",
  status: "active",
  tokenVersion: 2,
  showroom: { id: "sh1", code: "RIYADH" },
};

describe("resolveSellerAccess", () => {
  it("returns active + DB-derived seller for a valid, active seller", async () => {
    const res = await resolveSellerAccess(dbReturning(activeRow), "s1", 2);
    expect(res).toEqual({
      outcome: "active",
      seller: {
        id: "s1",
        name: "بائع",
        sellerCode: "S001",
        showroomId: "sh1",
        showroomCode: "RIYADH",
      },
    });
  });

  it("returns not_found when the seller does not exist", async () => {
    const res = await resolveSellerAccess(dbReturning(null), "missing", 0);
    expect(res.outcome).toBe("not_found");
  });

  it("returns token_version_mismatch on a stale session token", async () => {
    const res = await resolveSellerAccess(dbReturning(activeRow), "s1", 1);
    expect(res.outcome).toBe("token_version_mismatch");
  });

  it("returns showroom_missing when the showroom relation is absent", async () => {
    const res = await resolveSellerAccess(
      dbReturning({ ...activeRow, showroom: null }),
      "s1",
      2,
    );
    expect(res.outcome).toBe("showroom_missing");
  });

  it("returns disabled for a non-active seller", async () => {
    const res = await resolveSellerAccess(
      dbReturning({ ...activeRow, status: "disabled" }),
      "s1",
      2,
    );
    expect(res.outcome).toBe("disabled");
  });

  it("prioritizes a stale token over a disabled status", async () => {
    const res = await resolveSellerAccess(
      dbReturning({ ...activeRow, status: "disabled" }),
      "s1",
      99,
    );
    expect(res.outcome).toBe("token_version_mismatch");
  });
});
