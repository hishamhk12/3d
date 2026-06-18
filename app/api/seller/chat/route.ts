// POST /api/seller/chat — server-only proxy from the authenticated 3d seller
// area to the existing chatbot FastAPI `/internal/chat`.
//
// Flow: feature flag → verified seller session → validate body → mint a
// short-lived external-seller JWT (identity from the DB, never the browser) →
// server-to-server call to FastAPI → safe response. The browser never sees the
// FastAPI URL, the JWT, the secret, or any upstream stack trace/headers.
import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { getCurrentSeller } from "@/lib/seller/auth";
import { sellerChatSchema } from "@/lib/seller/chat-validation";
import {
  callFastapiChat,
  isSellerChatEnabled,
  sanitizeChatResponse,
} from "@/lib/seller/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = getLogger("seller-chat");

export async function POST(req: Request) {
  const startedAt = Date.now();

  // 1) Feature flag.
  if (!isSellerChatEnabled()) {
    log.warn({ errorCategory: "feature_disabled" }, "seller_chat_503");
    return NextResponse.json(
      { error: "خدمة المحادثة غير متاحة حالياً." },
      { status: 503 },
    );
  }

  // 2) Verified seller session (re-resolved from the 3d DB; null = not active).
  const seller = await getCurrentSeller();
  if (!seller) {
    return NextResponse.json(
      { error: "يجب تسجيل الدخول للوصول إلى هذه الخدمة." },
      { status: 401 },
    );
  }

  // 3) JSON body only.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "صيغة الطلب غير صحيحة" }, { status: 400 });
  }

  // 4/5/6) Accept ONLY {question, style}; `.strict()` rejects any attempt to send
  // sellerId / showroomId / actorType / role from the browser.
  const parsed = sellerChatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "مدخلات غير صحيحة" },
      { status: 400 },
    );
  }

  // 7/8/9) Mint the external token and call FastAPI server-to-server. Identity
  // (sub + showroomId) comes from the session-derived seller, not the payload.
  const result = await callFastapiChat(seller, {
    question: parsed.data.question,
    style: parsed.data.style,
  });

  const durationMs = Date.now() - startedAt;

  if (result.error) {
    // Map every upstream condition to a safe status; never leak upstream details.
    const status =
      result.error === "timeout"
        ? 504
        : result.error === "unreachable" || result.error === "preflight_config"
          ? 503
          : 502; // upstream_auth | upstream_status | upstream_invalid
    if (status === 503) {
      log.warn({ errorCategory: result.error }, "seller_chat_503");
    } else {
      log.warn(
        {
          sellerId: seller.id,
          identityDomain: "external_seller",
          outcome: result.error,
          upstreamStatus: result.status,
          durationMs,
        },
        "seller_chat_upstream_failed",
      );
    }
    return NextResponse.json(
      { error: "تعذّر الحصول على رد من المساعد. حاول مرة أخرى." },
      { status },
    );
  }

  // 10) Return the existing chatbot response shape, minus internal-only fields.
  log.info(
    {
      sellerId: seller.id,
      identityDomain: "external_seller",
      outcome: "ok",
      upstreamStatus: result.status,
      durationMs,
    },
    "seller_chat_ok",
  );
  return NextResponse.json(sanitizeChatResponse(result.data));
}
