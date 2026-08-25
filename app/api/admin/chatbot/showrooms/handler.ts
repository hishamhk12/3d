// GET  /api/admin/chatbot/showrooms - list/search showrooms with seller counts.
// POST /api/admin/chatbot/showrooms - create a showroom (normalized unique code).
// No deletion endpoint exists (intentional - see the PATCH route). Admin only.
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { getLogger } from "@/lib/logger";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { createShowroomSchema } from "@/lib/admin/chatbot/validation";
import { toSafeShowroom } from "@/lib/admin/chatbot/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("admin-chatbot-showrooms");
const LIST_LIMIT = 200;

export async function GET(req: Request) {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const where: Prisma.ShowroomWhereInput = q
    ? {
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const showrooms = await prisma.showroom.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { sellers: true } },
    },
    orderBy: { code: "asc" },
    take: LIST_LIMIT,
  });

  return NextResponse.json({ showrooms: showrooms.map(toSafeShowroom) });
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

  const parsed = createShowroomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const showroom = await prisma.showroom.create({
      data: { name: parsed.data.name, code: parsed.data.code },
      select: {
        id: true,
        code: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { sellers: true } },
      },
    });
    log.info({ showroomId: showroom.id }, "admin_showroom_created");
    return NextResponse.json({ showroom: toSafeShowroom(showroom) }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Showroom code already exists" }, { status: 409 });
    }
    log.error({ err }, "admin_showroom_create_failed");
    return NextResponse.json({ error: "Could not create showroom" }, { status: 500 });
  }
}
