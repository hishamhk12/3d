import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getLogger } from "@/lib/logger";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";
import { prisma } from "@/lib/server/prisma";

const log = getLogger("admin-screens-api");

async function requireAdminResponse(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// ─── PATCH /api/admin/screens/[screenId] ──────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ screenId: string }> },
): Promise<NextResponse> {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const { screenId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if ("name" in patch) {
    if (typeof patch.name !== "string" || !patch.name) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    data.name = patch.name;
  }

  if ("location" in patch) {
    data.location = typeof patch.location === "string" ? patch.location : null;
  }

  if ("dailyBudget" in patch) {
    if (typeof patch.dailyBudget !== "number" || patch.dailyBudget < 1) {
      return NextResponse.json({ error: "dailyBudget must be a positive integer" }, { status: 400 });
    }
    data.dailyBudget = Math.floor(patch.dailyBudget);
  }

  if ("isActive" in patch) {
    if (typeof patch.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
    }
    data.isActive = patch.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const screen = await prisma.screen.update({
      where: { id: screenId },
      data,
      select: {
        id: true,
        name: true,
        location: true,
        dailyBudget: true,
        isActive: true,
        lastRenderAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(screen);
  } catch (err) {
    log.error({ err, screenId }, "Failed to update screen");
    return NextResponse.json({ error: "Screen not found or update failed" }, { status: 404 });
  }
}

// ─── DELETE /api/admin/screens/[screenId] ─────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ screenId: string }> },
): Promise<NextResponse> {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const { screenId } = await context.params;

  try {
    await prisma.screen.delete({ where: { id: screenId } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    log.error({ err, screenId }, "Failed to delete screen");
    return NextResponse.json({ error: "Screen not found or delete failed" }, { status: 404 });
  }
}
