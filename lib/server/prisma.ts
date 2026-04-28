import "server-only";

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

// In serverless environments (Vercel) many short-lived function invocations
// run concurrently, each potentially opening its own connection pool. Without
// an explicit limit, 50 concurrent functions × pg's default of 10 = 500
// connection attempts — well above what most managed Postgres providers allow.
//
// DATABASE_POOL_SIZE controls this per-deployment:
//   - Raw Postgres (no external pooler): 3–5
//   - With PgBouncer / Neon pooled / Supabase Supavisor: 1–2
//     (the pooler multiplexes, so each serverless connection counts less)
//
// idleTimeoutMillis: release idle connections after 10 s so short-lived
//   invocations don't hold slots between requests.
// connectionTimeoutMillis: fail fast (5 s) rather than queue forever when
//   the DB is under load or unreachable.
function parsePoolSize(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MAX_CONNECTIONS = parsePoolSize(process.env.DATABASE_POOL_SIZE, 5);

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

const pool =
  globalForPrisma.prismaPool ??
  new Pool({
    connectionString,
    max: MAX_CONNECTIONS,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 12_000,
  });

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["warn", "error"],
  });

// Cache on globalThis so warm container re-invocations (dev hot-reload and
// Vercel warm starts) reuse the same pool instead of opening a new one.
if (!globalForPrisma.prismaPool) {
  globalForPrisma.prismaPool = pool;
}
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
