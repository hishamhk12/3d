import "server-only";

// Canonical, server-only seller-access policy. Derives ALL seller state from the
// 3d database on each call — never from JWT claims (only `sub` + claimed
// tokenVersion are advisory inputs). Used by both login and session resolution
// so there is a single place that decides whether a seller may enter.
import type { PrismaClient } from "@/lib/generated/prisma";

// The DB-derived current-seller shape. showroomId/showroomCode come from the
// seller's OWN showroom relation, never from the browser.
export interface CurrentSeller {
  id: string;
  name: string;
  sellerCode: string;
  showroomId: string;
  showroomCode: string;
}

export type SellerAccessOutcome =
  | "active"
  | "not_found"
  | "token_version_mismatch"
  | "showroom_missing"
  | "disabled";

export type SellerAccessResult =
  | { outcome: "active"; seller: CurrentSeller }
  | { outcome: Exclude<SellerAccessOutcome, "active"> };

/**
 * Load the seller by id and decide access. Order matters: a missing row, then a
 * stale session (tokenVersion), then a data-integrity issue (no showroom), then
 * a non-active status. Returns the DB-derived CurrentSeller only when active.
 */
export async function resolveSellerAccess(
  db: PrismaClient,
  sellerId: string,
  claimedTokenVersion: number,
): Promise<SellerAccessResult> {
  const seller = await db.seller.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      name: true,
      sellerCode: true,
      status: true,
      tokenVersion: true,
      showroom: { select: { id: true, code: true } },
    },
  });

  if (!seller) return { outcome: "not_found" };
  if (seller.tokenVersion !== claimedTokenVersion) {
    return { outcome: "token_version_mismatch" };
  }
  if (!seller.showroom) return { outcome: "showroom_missing" };
  if (seller.status !== "active") return { outcome: "disabled" };

  return {
    outcome: "active",
    seller: {
      id: seller.id,
      name: seller.name,
      sellerCode: seller.sellerCode,
      showroomId: seller.showroom.id,
      showroomCode: seller.showroom.code,
    },
  };
}
