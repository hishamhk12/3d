import type { Direction, Locale } from "@/lib/i18n/types";
import { SUPPORTED_LOCALES } from "@/lib/i18n/types";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE_NAME = "panorama-studio-locale";
export const LOCALE_STORAGE_KEY = "panorama-studio-locale";

const RTL_LOCALES = new Set<Locale>(["ar"]);

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && SUPPORTED_LOCALES.includes(value as Locale);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function getLocaleDirection(locale: Locale): Direction {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function getLocaleLabel(locale: Locale) {
  return locale === "ar" ? "العربية" : "English";
}
