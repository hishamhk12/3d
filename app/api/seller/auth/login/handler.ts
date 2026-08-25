// POST /api/seller/auth/login — seller code + showroom code + password →
// signed seller_session cookie. Validation rules (in order): input shape →
// rate-limit → seller lookup → constant-time password compare → combined
// credential/identity check → status check.
//
// Anti-enumeration: unknown seller, unknown showroom, wrong relationship, and
// wrong password ALL return the same generic 401. A disabled account returns 403
// only AFTER credentials + showroom membership are verified. Never log codes,
// passwords, hashes, tokens, or cookie values.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { getLogger } from "@/lib/logger";
import { checkIpRateLimit, getClientIp } from "@/lib/ip-rate-limit";
import { sellerLoginSchema } from "@/lib/seller/validation";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/seller/password";
import {
  createSellerToken,
  SELLER_SESSION_COOKIE,
  SELLER_SESSION_COOKIE_OPTIONS,
} from "@/lib/seller/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("seller-login");

const GENERIC_INVALID = "بيانات الدخول غير صحيحة.";
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_SECONDS = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "صيغة الطلب غير صحيحة" }, { status: 400 });
  }

  const parsed = sellerLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "مدخلات غير صحيحة" },
      { status: 400 },
    );
  }

  const ip = getClientIp(req.headers);
  const limited = await checkIpRateLimit(ip, {
    keyPrefix: "seller-login",
    limit: LOGIN_RATE_LIMIT,
    windowSeconds: LOGIN_RATE_WINDOW_SECONDS,
  });
  if (limited.limited) {
    return NextResponse.json(
      { error: "محاولات كثيرة. حاول لاحقاً." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const { sellerCode, showroomCode, password } = parsed.data;

  const seller = await prisma.seller.findUnique({
    where: { sellerCode },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      tokenVersion: true,
      showroom: { select: { code: true } },
    },
  });

  // Always run a compare (against a dummy hash when absent) to flatten timing.
  const hashForComparison = seller?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(password, hashForComparison);

  // Combine every credential/identity check before branching so no single failed
  // condition is distinguishable from another.
  const credentialsValid =
    Boolean(seller) &&
    Boolean(seller?.passwordHash) &&
    passwordMatches &&
    seller?.showroom?.code === showroomCode;

  if (!credentialsValid) {
    log.warn({ outcome: "invalid_credentials" }, "seller_login_failed");
    return NextResponse.json({ error: GENERIC_INVALID }, { status: 401 });
  }

  // Credentials + showroom membership are correct; only now reveal a disabled
  // account (post-authentication, so this does not enable enumeration).
  if (seller!.status !== "active") {
    log.warn({ sellerId: seller!.id, outcome: "disabled" }, "seller_login_blocked");
    return NextResponse.json(
      { error: "تم تعطيل هذا الحساب.", code: "disabled" },
      { status: 403 },
    );
  }

  const token = await createSellerToken({
    id: seller!.id,
    tokenVersion: seller!.tokenVersion,
  });

  const res = NextResponse.json({ ok: true, redirectTo: "/seller/chat" });
  res.cookies.set(SELLER_SESSION_COOKIE, token, SELLER_SESSION_COOKIE_OPTIONS);
  log.info({ sellerId: seller!.id, outcome: "success" }, "seller_login_success");
  return res;
}
