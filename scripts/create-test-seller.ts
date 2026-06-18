// TEMPORARY, DEV-ONLY: create one test showroom + one active test seller in the
// 3d database for the seller-auth smoke test. Idempotent (upsert). Never logs the
// plaintext password or the password hash.
//
// Run (password supplied process-scoped, never committed):
//   ALLOW_TEST_SELLER_CREATION=true TEST_SELLER_PASSWORD='<strong>' \
//     node --import ./scripts/_dev-ts-loader.mjs scripts/create-test-seller.ts
//
// Safety:
//   - Refuses unless ALLOW_TEST_SELLER_CREATION=true.
//   - Refuses when NODE_ENV=production unless CONFIRM_PRODUCTION_TEST_SELLER=true.
//   - Only touches the two TEST records below; never customer/admin/room-preview.
//   - NOT wired into any automatic/production seed.
import { PrismaClient } from "../lib/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";
import { hashPassword, isPasswordWithinByteLimit, MIN_PASSWORD_LENGTH } from "../lib/seller/password.ts";
import { normalizeSellerCode, normalizeShowroomCode } from "../lib/seller/codes.ts";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const SHOWROOM_CODE = "TEST-RIYADH";
const SHOWROOM_NAME = "Temporary Test Showroom";
const SELLER_CODE = "TEST-SELLER-001";
const SELLER_NAME = "Temporary Test Seller";

function fail(msg: string): never {
  console.error(`[create-test-seller] REFUSED: ${msg}`);
  process.exit(1);
}

async function main() {
  if (process.env.ALLOW_TEST_SELLER_CREATION !== "true") {
    fail("set ALLOW_TEST_SELLER_CREATION=true to run this script.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CONFIRM_PRODUCTION_TEST_SELLER !== "true"
  ) {
    fail("NODE_ENV=production requires CONFIRM_PRODUCTION_TEST_SELLER=true.");
  }

  const password = process.env.TEST_SELLER_PASSWORD;
  if (!password) {
    fail("set TEST_SELLER_PASSWORD (process-scoped; never commit it).");
  }
  if (password.length < MIN_PASSWORD_LENGTH || !isPasswordWithinByteLimit(password)) {
    fail("TEST_SELLER_PASSWORD must be >= 8 chars and <= 72 UTF-8 bytes.");
  }

  const showroomCode = normalizeShowroomCode(SHOWROOM_CODE);
  const sellerCode = normalizeSellerCode(SELLER_CODE);
  const passwordHash = await hashPassword(password);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const showroom = await prisma.showroom.upsert({
      where: { code: showroomCode },
      create: { code: showroomCode, name: SHOWROOM_NAME },
      update: { name: SHOWROOM_NAME },
      select: { id: true, code: true },
    });

    const seller = await prisma.seller.upsert({
      where: { sellerCode },
      create: {
        sellerCode,
        name: SELLER_NAME,
        passwordHash,
        status: "active",
        showroomId: showroom.id,
      },
      update: {
        name: SELLER_NAME,
        passwordHash,
        status: "active",
        showroomId: showroom.id,
      },
      select: { id: true, sellerCode: true, status: true, showroomId: true },
    });

    // Safe identifiers only — no password, no hash.
    console.log(
      JSON.stringify(
        {
          ok: true,
          showroom: { id: showroom.id, code: showroom.code },
          seller: {
            id: seller.id,
            sellerCode: seller.sellerCode,
            status: seller.status,
            showroomId: seller.showroomId,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[create-test-seller] ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
