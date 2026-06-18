// Server guard for the whole /seller subtree: requires an authenticated, active
// seller whose session resolves against the 3d database. Unauthenticated/expired/
// revoked sessions are redirected to the seller login by requireSeller().
import { requireSeller } from "@/lib/seller/auth";

export default async function SellerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSeller();
  return <>{children}</>;
}
