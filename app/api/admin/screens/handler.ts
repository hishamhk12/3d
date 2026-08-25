import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getLogger } from "@/lib/logger";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";
import { prisma } from "@/lib/server/prisma";
import {
  generateScreenToken,
  hashScreenToken,
} from "@/lib/room-preview/screen-token";

const log = getLogger("admin-screens-api");

async function requireAdminResponse(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// ─── GET /api/admin/screens ────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  try {
    const screens = await prisma.screen.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        location: true,
        dailyBudget: true,
        isActive: true,
        lastRenderAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(screens);
  } catch (err) {
    log.error({ err }, "Failed to list screens");
    return NextResponse.json({ error: "Failed to list screens" }, { status: 500 });
  }
}

// ─── POST /api/admin/screens ───────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).name !== "string" ||
    !(body as Record<string, unknown>).name
  ) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { name, location, dailyBudget } = body as Record<string, unknown>;

  if (dailyBudget !== undefined && (typeof dailyBudget !== "number" || dailyBudget < 1)) {
    return NextResponse.json({ error: "dailyBudget must be a positive integer" }, { status: 400 });
  }

  try {
    const token = generateScreenToken();
    const secretHash = hashScreenToken(token);

    const screen = await prisma.screen.create({
      data: {
        name: name as string,
        location: typeof location === "string" ? location : null,
        dailyBudget: typeof dailyBudget === "number" ? Math.floor(dailyBudget) : 15,
        secretHash,
      },
      select: {
        id: true,
        name: true,
        location: true,
        dailyBudget: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Return the plain-text token exactly once — it is never stored in DB.
    return NextResponse.json({ ...screen, token }, { status: 201 });
  } catch (err) {
    log.error({ err }, "Failed to create screen");
    return NextResponse.json({ error: "Failed to create screen" }, { status: 500 });
  }
}
