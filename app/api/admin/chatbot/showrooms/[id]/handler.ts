// PATCH /api/admin/chatbot/showrooms/[id] - edit a showroom's name and/or its
// normalized code (with uniqueness conflict validation). No DELETE handler exists
// in this phase - showrooms are never destructively removed (deletion is not
// modeled; archive is deferred). Admin session required.
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { getLogger } from "@/lib/logger";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { updateShowroomSchema } from "@/lib/admin/chatbot/validation";
import { toSafeShowroom } from "@/lib/admin/chatbot/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("admin-chatbot-showrooms");

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

  const parsed = updateShowroomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const existing = await prisma.showroom.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Showroom not found" }, { status: 404 });
  }

  const data: Prisma.ShowroomUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.code !== undefined) data.code = parsed.data.code;

  try {
    const showroom = await prisma.showroom.update({
      where: { id },
      data,
      select: {
        id: true,
        code: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { sellers: true } },
      },
    });
    log.info({ showroomId: id }, "admin_showroom_updated");
    return NextResponse.json({ showroom: toSafeShowroom(showroom) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Showroom code already exists" }, { status: 409 });
    }
    log.error({ err }, "admin_showroom_update_failed");
    return NextResponse.json({ error: "Could not update showroom" }, { status: 500 });
  }
}
