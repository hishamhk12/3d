"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signAdminToken, ADMIN_SESSION_COOKIE } from "@/lib/admin/auth";
import { checkIpRateLimit, getClientIp } from "@/lib/ip-rate-limit";

/** Maximum login attempts per IP per window. */
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_SECONDS = 60;

// ─── Credential validation ────────────────────────────────────────────────────
//
// Both values are hashed with SHA-256 before comparing so that timingSafeEqual
// always receives equal-length buffers, regardless of input length.
// The security guarantee comes from these env vars being secret — not stored
// in the DB, not in source control.

function checkCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.ADMIN_USERNAME ?? "";
  const expectedPass = process.env.ADMIN_PASSWORD ?? "";

  // Refuse login if credentials are not configured.
  if (!expectedUser || !expectedPass) return false;

  const hash = (s: string) => createHash("sha256").update(s).digest();

  const userMatch = timingSafeEqual(hash(username), hash(expectedUser));
  const passMatch = timingSafeEqual(hash(password), hash(expectedPass));

  return userMatch && passMatch;
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginAction(formData: FormData) {
  const ip = getClientIp(await headers());
  const rateLimit = await checkIpRateLimit(ip, {
    keyPrefix: "admin-login",
    limit: LOGIN_RATE_LIMIT,
    windowSeconds: LOGIN_RATE_WINDOW_SECONDS,
  });

  if (rateLimit.limited) {
    redirect("/admin/login?error=1");
  }

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!checkCredentials(username, password)) {
    redirect("/admin/login?error=1");
  }

  const token = await signAdminToken();
  const cookieStore = await cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: 8 * 60 * 60, // 8 hours
  });

  // Only allow redirecting to paths under /admin to prevent open redirect.
  const destination = next.startsWith("/admin") ? next : "/admin";
  redirect(destination);
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
  redirect("/admin/login");
}
