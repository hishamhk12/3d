// Protected seller chat page (Phase 3). Renders the full ported inventory
// chatbot UI (RTL phone shell, hero, bubbles, inventory cards, code autocomplete,
// mode selector) — inventory scope only. The seller is re-resolved from the 3d
// database on every request via the /seller layout guard and requireSeller();
// only display-safe fields reach the client.
//
// Cairo is loaded SCOPED here (variable on the wrapper) so the seller-chat
// subtree matches the original typography without touching the app-wide
// Tajawal/Inter fonts.
import { Cairo } from "next/font/google";
import { requireSeller } from "@/lib/seller/auth";
import SellerChatExperience from "@/components/seller/chat/SellerChatExperience";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cairo",
  display: "swap",
});

export const dynamic = "force-dynamic";

export default async function SellerChatPage() {
  const seller = await requireSeller();

  return (
    <div className={cairo.variable}>
      <SellerChatExperience sellerName={seller.name} showroomCode={seller.showroomCode} />
    </div>
  );
}
