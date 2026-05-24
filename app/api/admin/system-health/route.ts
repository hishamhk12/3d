import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";
import { isRedisEnabled, isRedisDisabledByFlag, getRedisClient } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function requireAdminResponse(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export type SystemHealthResponse = {
  ok: boolean;
  database: {
    configured: boolean;
    connected: boolean;
    latencyMs: number | null;
  };
  redis: {
    configured: boolean;
    enabled: boolean;
    connected: boolean;
    latencyMs: number | null;
  };
  realtime: {
    mode: "redis" | "polling_only";
    fallback: "polling_available";
  };
  storage: {
    provider: string;
    configured: boolean;
    warning: string | null;
  };
  renderProvider: {
    configured: boolean;
  };
  env: {
    missing: string[];
    warnings: string[];
  };
  sessions: {
    rendering: number;
    live: number;
  };
  checkedAt: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  // ── Database ──────────────────────────────────────────────────────────────
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  let dbConnected = false;
  let dbLatencyMs: number | null = null;

  if (dbConfigured) {
    const t = Date.now();
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 4_000);
      dbConnected = true;
      dbLatencyMs = Date.now() - t;
    } catch {
      // dbConnected stays false
    }
  }

  // ── Redis ──────────────────────────────────────────────────────────────────
  const redisConfigured = Boolean(process.env.REDIS_URL);
  const redisEnabled = isRedisEnabled();
  let redisConnected = false;
  let redisLatencyMs: number | null = null;

  if (redisEnabled) {
    const t = Date.now();
    try {
      await withTimeout(getRedisClient().ping(), 3_000);
      redisConnected = true;
      redisLatencyMs = Date.now() - t;
    } catch {
      // redisConnected stays false
    }
  }

  const realtimeMode = redisConnected ? "redis" : "polling_only";

  // ── Storage ────────────────────────────────────────────────────────────────
  const storageProvider = process.env.STORAGE_PROVIDER ?? "local";
  let storageConfigured = true;
  let storageWarning: string | null = null;

  if (storageProvider === "r2" || storageProvider === "s3") {
    const required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_PUBLIC_URL"];
    const missing = required.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      storageConfigured = false;
    }
  } else if (storageProvider === "local") {
    if (process.env.NODE_ENV === "production") {
      storageConfigured = false;
      storageWarning = "Local storage is not supported in production — files will be lost on redeploy.";
    } else {
      storageWarning = "Using local filesystem storage (development only).";
    }
  }

  // ── Render provider ────────────────────────────────────────────────────────
  const renderProviderConfigured = Boolean(process.env.GEMINI_API_KEY);

  // ── Env secrets ───────────────────────────────────────────────────────────
  const isProd = process.env.NODE_ENV === "production";
  const envMissing: string[] = [];
  const envWarnings: string[] = [];

  const alwaysRequired = ["DATABASE_URL"];
  const prodRequired = [
    "SESSION_TOKEN_SECRET",
    "CLEANUP_SECRET",
    "NEXT_PUBLIC_BASE_URL",
    "ADMIN_JWT_SECRET",
    "GEMINI_API_KEY",
  ];

  for (const key of alwaysRequired) {
    if (!process.env[key]) envMissing.push(key);
  }
  for (const key of prodRequired) {
    if (!process.env[key]) {
      if (isProd) envMissing.push(key);
      else envWarnings.push(`${key} not set (required in production)`);
    }
  }

  if (!redisConfigured) {
    if (isProd) {
      envWarnings.push("REDIS_URL not set — SSE screen updates will use polling fallback only");
    }
  } else if (isRedisDisabledByFlag()) {
    envWarnings.push("ENABLE_REDIS=false — Redis is configured but intentionally disabled");
  }

  if (!process.env.CRON_SECRET) {
    envWarnings.push("CRON_SECRET not set — Vercel Cron authentication is disabled");
  }

  // ── Session stats (lightweight counts) ───────────────────────────────────
  let renderingCount = 0;
  let liveCount = 0;

  try {
    [renderingCount, liveCount] = await Promise.all([
      prisma.roomPreviewSession.count({ where: { status: "rendering" } }),
      prisma.roomPreviewSession.count({
        where: {
          status: {
            in: [
              "created",
              "waiting_for_mobile",
              "mobile_connected",
              "room_selected",
              "product_selected",
              "ready_to_render",
              "rendering",
            ],
          },
        },
      }),
    ]);
  } catch {
    // Non-critical — counts are optional
  }

  const ok =
    dbConnected &&
    renderProviderConfigured &&
    storageConfigured &&
    envMissing.length === 0;

  const body: SystemHealthResponse = {
    ok,
    database: { configured: dbConfigured, connected: dbConnected, latencyMs: dbLatencyMs },
    redis: {
      configured: redisConfigured,
      enabled: redisEnabled,
      connected: redisConnected,
      latencyMs: redisLatencyMs,
    },
    realtime: { mode: realtimeMode, fallback: "polling_available" },
    storage: { provider: storageProvider, configured: storageConfigured, warning: storageWarning },
    renderProvider: { configured: renderProviderConfigured },
    env: { missing: envMissing, warnings: envWarnings },
    sessions: { rendering: renderingCount, live: liveCount },
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: ok ? 200 : 207 });
}
