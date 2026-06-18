// TEMPORARY, DEV-ONLY end-to-end proof for the Phase 2D seller-chat integration.
//
// Exercises the REAL 3d minting code (lib/seller/fastapi.ts → callFastapiChat)
// against a LIVE FastAPI /internal/chat and the real chatbot database, using the
// temporary 3d seller. It:
//   1. Activates the temp seller (new random password, tokenVersion++, active).
//   2. Sends a product question, then a follow-up ("وبجدة؟"), via the real proxy
//      helper — proving external context resolves to the previous product code.
//   3. Verifies a different (fixture) external seller does NOT inherit that context.
//   4. Reads back the chatbot ChatMessage rows to confirm the external audit shape.
//   5. Disables the temp seller again (tokenVersion++), invalidating test sessions.
//
// Never prints the plaintext password, nor any question/answer text — only safe
// structural metadata (status codes, productCode, identity columns).
//
// Run (guarded; secrets process-scoped, never committed):
//   RUN_SELLER_CHAT_E2E=true node --import ./scripts/_dev-ts-loader.mjs scripts/seller-chat-e2e.ts
import "server-only";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/index.js";
import { hashPassword } from "../lib/seller/password.ts";
import {
  callFastapiChat,
  callFastapiCodeSuggestions,
  mintExternalSellerToken,
} from "../lib/seller/fastapi.ts";
import type { CurrentSeller } from "../lib/seller/account-access.ts";

const SELLER_CODE = "TEST-SELLER-001";
const CHATBOT_DB = "postgresql://postgres:postgres@localhost:5432/inventory";
const PRODUCT_CODE = "CRPT050.006"; // exists with Jeddah stock

function fail(msg: string): never {
  console.error(`[seller-chat-e2e] REFUSED: ${msg}`);
  process.exit(1);
}

/** Read EXTERNAL_SELLER_JWT_SECRET from the FastAPI service .env so the minted
 *  token is guaranteed to match the live service (no value is printed). */
function loadFastapiSecret(): string {
  const env = readFileSync("../chat/service/.env", "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("EXTERNAL_SELLER_JWT_SECRET="));
  if (!line) fail("EXTERNAL_SELLER_JWT_SECRET not found in chat/service/.env");
  return line!.slice("EXTERNAL_SELLER_JWT_SECRET=".length).trim().replace(/^"|"$/g, "");
}

async function main() {
  if (process.env.RUN_SELLER_CHAT_E2E !== "true") {
    fail("set RUN_SELLER_CHAT_E2E=true to run this script.");
  }

  // Match the live FastAPI trust boundary; target the local sidecar.
  process.env.EXTERNAL_SELLER_JWT_SECRET = loadFastapiSecret();
  process.env.CHATBOT_FASTAPI_URL = process.env.CHATBOT_FASTAPI_URL || "http://localhost:8001";
  process.env.SELLER_CHAT_ENABLED = "true";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const results: Record<string, unknown> = {};

  try {
    // 1) Activate the temp seller with a fresh random password (never printed).
    const newPassword = randomBytes(18).toString("base64url"); // >= 8 chars, < 72 bytes
    const passwordHash = await hashPassword(newPassword);
    const activated = await prisma.seller.update({
      where: { sellerCode: SELLER_CODE },
      data: { passwordHash, status: "active", tokenVersion: { increment: 1 } },
      select: {
        id: true,
        name: true,
        sellerCode: true,
        status: true,
        tokenVersion: true,
        showroom: { select: { id: true, code: true } },
      },
    });
    if (!activated.showroom) fail("temp seller has no showroom");
    results.activated = {
      sellerId: activated.id,
      showroomId: activated.showroom.id,
      status: activated.status,
      tokenVersion: activated.tokenVersion,
    };

    const seller: CurrentSeller = {
      id: activated.id,
      name: activated.name,
      sellerCode: activated.sellerCode,
      showroomId: activated.showroom.id,
      showroomCode: activated.showroom.code,
    };

    // 2) Real proxy helper → live FastAPI: product question, then follow-up.
    const first = await callFastapiChat(seller, {
      question: `كم باقي من ${PRODUCT_CODE}؟`,
      style: "balanced",
    });
    results.firstAsk = {
      status: first.status,
      error: first.error ?? null,
      productCode: (first.data as { productCode?: string } | undefined)?.productCode ?? null,
    };

    const followup = await callFastapiChat(seller, { question: "وبجدة؟", style: "balanced" });
    results.followUp = {
      status: followup.status,
      error: followup.error ?? null,
      productCode: (followup.data as { productCode?: string } | undefined)?.productCode ?? null,
      warehouse: (followup.data as { warehouse?: string } | undefined)?.warehouse ?? null,
    };

    // 3) Cross-seller isolation via a FIXTURE external seller (no real DB row): a
    //    bare follow-up must NOT resolve to seller A's product context.
    const fixtureB: CurrentSeller = {
      id: "fixture-seller-B",
      name: "Fixture B",
      sellerCode: "FIX-B",
      showroomId: "fixture-showroom-B",
      showroomCode: "FIX",
    };
    const isolated = await callFastapiChat(fixtureB, { question: "وبجدة؟", style: "balanced" });
    results.crossSeller = {
      status: isolated.status,
      productCode: (isolated.data as { productCode?: string } | undefined)?.productCode ?? null,
    };

    // 3b) Product-code autocomplete via the REAL proxy helper (the second
    //     external-accessible endpoint). Returns real CODE-ONLY suggestions.
    const suggestions = await callFastapiCodeSuggestions(seller, "CRPT");
    results.codeSuggestions = {
      count: suggestions.length,
      sample: suggestions.slice(0, 3).map((s) => s.code),
      codeOnlyShape: suggestions.every(
        (s) => Object.keys(s).sort().join(",") === "code,label",
      ),
    };

    // 3c) Allowlist proof: the SAME external token must be REJECTED on a
    //     non-allowlisted inventory endpoint (search) — external sellers reach
    //     ONLY /internal/chat and /internal/inventory/code-suggestions.
    const token = await mintExternalSellerToken(seller);
    const base = process.env.CHATBOT_FASTAPI_URL!;
    const blocked = await fetch(`${base}/internal/inventory/search?q=CRPT050.006`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const allowedSugg = await fetch(
      `${base}/internal/inventory/code-suggestions?q=CRPT`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    results.allowlist = {
      searchStatusBlocked: blocked.status, // expect 401
      codeSuggestionsStatusAllowed: allowedSugg.status, // expect 200
    };

    // 4) Verify the external audit shape in the chatbot DB (read-only).
    const chatPool = new Pool({ connectionString: CHATBOT_DB, max: 1 });
    try {
      const rows = await chatPool.query(
        'SELECT "userId", "externalActorType", "externalActorId", "externalShowroomId", ' +
          '"productCode" FROM "ChatMessage" WHERE "externalActorId" = $1 ' +
          'ORDER BY "createdAt" DESC LIMIT 5',
        [`3d-seller:${seller.id}`],
      );
      results.auditRows = rows.rows.map((r) => ({
        userIdNull: r.userId === null,
        externalActorType: r.externalActorType,
        externalActorId: r.externalActorId,
        externalShowroomIdMatches: r.externalShowroomId === seller.showroomId,
        productCode: r.productCode,
      }));
    } finally {
      await chatPool.end();
    }
  } finally {
    // 5) Always return the temp seller to disabled + bump tokenVersion (revokes
    //    any session minted during the test). Kept for Phase 3.
    const disabled = await prisma.seller.update({
      where: { sellerCode: SELLER_CODE },
      data: { status: "disabled", tokenVersion: { increment: 1 } },
      select: { status: true, tokenVersion: true },
    });
    results.finalState = { status: disabled.status, tokenVersion: disabled.tokenVersion };
    await prisma.$disconnect();
    await pool.end();
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("[seller-chat-e2e] ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
