// PATCH /api/admin/chatbot/sellers/[id] - discriminated admin actions on a seller
// (3d DB): update_profile | activate | disable | reset_password | force_logout.
//
// Session-invalidation rule: disable, reset_password, force_logout, and a
// showroom change all bump tokenVersion (every protected seller request compares
// it, so active sessions are immediately revoked). The browser can never set
// tokenVersion / status / role directly - only the actions below.
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { getLogger } from "@/lib/logger";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { updateSellerSchema } from "@/lib/admin/chatbot/validation";
import { sellerSelect, toSafeSeller } from "@/lib/admin/chatbot/serialize";
import { hashPassword } from "@/lib/seller/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("admin-chatbot-sellers");

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = updateSellerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const existing = await prisma.seller.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  }

  const action = parsed.data.action;
  const data: Prisma.SellerUpdateInput = {};

  if (action === "update_profile") {
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.showroomId !== undefined) {
      const showroom = await prisma.showroom.findUnique({
        where: { id: parsed.data.showroomId },
        select: { id: true },
      });
      if (!showroom) {
        return NextResponse.json({ error: "Showroom not found" }, { status: 400 });
      }
      data.showroom = { connect: { id: parsed.data.showroomId } };
      // A showroom change re-scopes the seller's identity - invalidate sessions.
      data.tokenVersion = { increment: 1 };
    }
  } else if (action === "activate") {
    data.status = "active";
  } else if (action === "disable") {
    data.status = "disabled";
    data.tokenVersion = { increment: 1 };
  } else if (action === "reset_password") {
    data.passwordHash = await hashPassword(parsed.data.password);
    data.tokenVersion = { increment: 1 };
  } else if (action === "force_logout") {
    data.tokenVersion = { increment: 1 };
  }

  try {
    const seller = await prisma.seller.update({ where: { id }, data, select: sellerSelect });
    log.info({ sellerId: id, action }, "admin_seller_updated");
    return NextResponse.json({ seller: toSafeSeller(seller) });
  } catch (err) {
    log.error({ err, action }, "admin_seller_update_failed");
    return NextResponse.json({ error: "Could not update seller" }, { status: 500 });
  }
}
