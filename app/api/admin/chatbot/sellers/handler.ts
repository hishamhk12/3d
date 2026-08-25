// GET  /api/admin/chatbot/sellers - list/search/filter sellers (3d DB).
// POST /api/admin/chatbot/sellers - create a seller (hashed password, default
//      status disabled). Admin session required. passwordHash is never returned.
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { getLogger } from "@/lib/logger";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { createSellerSchema } from "@/lib/admin/chatbot/validation";
import { sellerSelect, toSafeSeller } from "@/lib/admin/chatbot/serialize";
import { hashPassword } from "@/lib/seller/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("admin-chatbot-sellers");
const LIST_LIMIT = 200;

export async function GET(req: Request) {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const showroomId = (searchParams.get("showroomId") ?? "").trim();
  const status = (searchParams.get("status") ?? "").trim();

  const where: Prisma.SellerWhereInput = {};
  if (q) {
    where.OR = [
      { sellerCode: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (showroomId) where.showroomId = showroomId;
  if (status === "active" || status === "disabled") where.status = status;

  const sellers = await prisma.seller.findMany({
    where,
    select: sellerSelect,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });

  return NextResponse.json({ sellers: sellers.map(toSafeSeller) });
}

export async function POST(req: Request) {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = createSellerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, sellerCode, showroomId, password, status } = parsed.data;

  const showroom = await prisma.showroom.findUnique({ where: { id: showroomId }, select: { id: true } });
  if (!showroom) {
    return NextResponse.json({ error: "Showroom not found" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  try {
    const seller = await prisma.seller.create({
      data: { name, sellerCode, passwordHash, status, showroomId },
      select: sellerSelect,
    });
    log.info({ sellerId: seller.id, status }, "admin_seller_created");
    return NextResponse.json({ seller: toSafeSeller(seller) }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Seller code already exists" }, { status: 409 });
    }
    log.error({ err }, "admin_seller_create_failed");
    return NextResponse.json({ error: "Could not create seller" }, { status: 500 });
  }
}
