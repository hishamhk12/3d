"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LOCALE,
  getLocaleDirection,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
} from "@/lib/i18n/config";
import { setLocaleCookie } from "@/lib/i18n/actions";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { Direction, Locale } from "@/lib/i18n/types";

type TranslationValues = Record<string, string | number>;

type I18nContextValue = {
  dir: Direction;
  isChangingLocale: boolean;
  locale: Locale;
  setLocale: (nextLocale: Locale) => void;
  t: TranslationDictionary;
  formatMessage: (template: string, values?: TranslationValues) => string;
};

type I18nProviderProps = {
  children: React.ReactNode;
  initialLocale?: Locale;
  initialLocaleCookiePresent?: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function persistLocale(locale: Locale) {
  if (typeof document !== "undefined") {
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}

function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") {
    return;
  }

  const dir = getLocaleDirection(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
  initialLocaleCookiePresent = false,
}: I18nProviderProps) {
  const router = useRouter();
  const [isChangingLocale, startTransition] = useTransition();
  const [locale, setLocaleState] = useState<Locale>(normalizeLocale(initialLocale));

  useEffect(() => {
    const storedLocale =
      typeof window !== "undefined" ? window.localStorage.getItem(LOCALE_STORAGE_KEY) : null;
    const normalizedStoredLocale = isSupportedLocale(storedLocale) ? storedLocale : null;

    if (!initialLocaleCookiePresent && normalizedStoredLocale && normalizedStoredLocale !== locale) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(normalizedStoredLocale);
      persistLocale(normalizedStoredLocale);
      applyDocumentLocale(normalizedStoredLocale);
      // Also sync to the server cookie so the next SSR picks it up.
      void setLocaleCookie(normalizedStoredLocale);
      // NOTE: router.refresh() was removed here intentionally.
      // Calling router.refresh() on locale mismatch causes Next.js to re-render
      // the full RSC tree, which remounts client components (including SplashScreen)
      // and resets their timers to zero — making the splash appear permanently stuck.
      // The locale state is already updated via setLocaleState above; the document
      // lang/dir is patched by applyDocumentLocale. A full RSC refresh is not needed.
      return;
    }

    persistLocale(locale);
    applyDocumentLocale(locale);
  }, [initialLocaleCookiePresent, locale, router]);

  const value = useMemo<I18nContextValue>(() => {
    const normalizedLocale = normalizeLocale(locale);

    return {
      dir: getLocaleDirection(normalizedLocale),
      isChangingLocale,
      locale: normalizedLocale,
      setLocale: (nextLocale: Locale) => {
        const normalizedNextLocale = normalizeLocale(nextLocale);

        if (normalizedNextLocale === normalizedLocale) {
          persistLocale(normalizedNextLocale);
          applyDocumentLocale(normalizedNextLocale);
          return;
        }

        persistLocale(normalizedNextLocale);
        applyDocumentLocale(normalizedNextLocale);
        setLocaleState(normalizedNextLocale);
        startTransition(() => {
          // Fire server action but do not await it. On LAN, Next.js might block
          // the server action due to strict Origin checks, which would throw
          // an error and prevent router.refresh() if awaited.
          setLocaleCookie(normalizedNextLocale).catch(() => {});
          router.refresh();
        });
      },
      t: dictionaries[normalizedLocale],
      formatMessage,
    };
  }, [isChangingLocale, locale, router]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider.");
  }

  return context;
}
