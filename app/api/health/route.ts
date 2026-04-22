import { prisma } from "@/lib/server/prisma";
import { isRedisEnabled, getRedisPublisher } from "@/lib/redis";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

interface HealthResponse {
  status: "ok" | "degraded";
  checks: Record<string, CheckStatus>;
  ts: string;
}

export async function GET(): Promise<Response> {
  const checks: Record<string, CheckStatus> = {};

  // ── Database ──────────────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // ── Redis (only when configured) ──────────────────────────────────────────
  if (isRedisEnabled()) {
    try {
      await getRedisPublisher().ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "error";
    }
  }

  const healthy = Object.values(checks).every((s) => s === "ok");

  const body: HealthResponse = {
    status: healthy ? "ok" : "degraded",
    checks,
    ts: new Date().toISOString(),
  };

  return Response.json(body, { status: healthy ? 200 : 503 });
}
