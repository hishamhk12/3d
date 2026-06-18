import "server-only";

// Server-side seller authentication entry points. The cookie only proves the
// seller id + tokenVersion; every call revalidates against the 3d database and
// returns a shape derived from the current row (never from stale JWT claims).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/server/prisma";
import { SELLER_SESSION_COOKIE, verifySellerToken } from "./session";
import { resolveSellerAccess, type CurrentSeller } from "./account-access";

export type { CurrentSeller } from "./account-access";

/** Current authenticated seller from the seller_session cookie, or null. */
export async function getCurrentSeller(): Promise<CurrentSeller | null> {
  const token = (await cookies()).get(SELLER_SESSION_COOKIE)?.value;
  const claims = await verifySellerToken(token);
  if (!claims) return null;

  const access = await resolveSellerAccess(prisma, claims.sub, claims.tokenVersion);
  return access.outcome === "active" ? access.seller : null;
}

/**
 * Require an authenticated seller for a page/layout. Redirects to the seller
 * login when the session is missing, expired, revoked, or the account is no
 * longer active.
 */
export async function requireSeller(): Promise<CurrentSeller> {
  const seller = await getCurrentSeller();
  if (!seller) {
    redirect("/login?type=seller&reason=login-required");
  }
  return seller;
}
