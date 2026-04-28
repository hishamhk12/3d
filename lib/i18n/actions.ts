"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, isSupportedLocale } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/types";

/**
 * Server action to set the locale cookie.
 *
 * Using a server action ensures the cookie is set via the HTTP `Set-Cookie`
 * response header, which is reliable across all browsers — including mobile
 * Safari and in-app WebViews that may restrict `document.cookie` writes over
 * plain HTTP or in cross-origin iframe contexts.
 */
export async function setLocaleCookie(locale: string): Promise<{ ok: boolean }> {
  if (!isSupportedLocale(locale)) {
    return { ok: false };
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale as Locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false, // readable by client JS too
  });

  return { ok: true };
}
