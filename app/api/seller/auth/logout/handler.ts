// POST /api/seller/auth/logout — clears the seller_session cookie. Touches only
// the seller cookie; admin and room-preview cookies are never read or modified.
import { NextResponse } from "next/server";
import { SELLER_SESSION_COOKIE } from "@/lib/seller/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Expire the cookie immediately (same name/path as when it was set).
  res.cookies.set(SELLER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
