"use client";

import clsx from "clsx";
import { Languages, LoaderCircle } from "lucide-react";
import { getLocaleLabel } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { SUPPORTED_LOCALES } from "@/lib/i18n/types";
import type { Locale } from "@/lib/i18n/types";

type LanguageSwitcherProps = {
  className?: string;
};

export default function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { isChangingLocale, locale, setLocale, t } = useI18n();

  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/40 px-2 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]",
        className,
      )}
      style={{
        backdropFilter: "blur(30px)",
        WebkitBackdropFilter: "blur(30px)",
      }}
      aria-label={t.common.language}
      title={t.common.language}
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/70 border border-white shadow-sm text-[#003C71]">
        {isChangingLocale ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Languages className="size-4" />
        )}
      </div>

      <div className="flex items-center gap-1">
        {SUPPORTED_LOCALES.map((entry) => {
          const isActive = entry === locale;

          return (
            <button
              key={entry}
              type="button"
              onClick={() => setLocale(entry as Locale)}
              disabled={isChangingLocale || isActive}
              aria-pressed={isActive}
              className={clsx(
                "inline-flex min-w-20 items-center justify-center rounded-full px-4 py-2 text-sm transition-all duration-300",
                isActive
                  ? "bg-white/80 font-bold border border-white/90 text-[#003C71] shadow-sm transform scale-105"
                  : "font-medium text-[#1d1d1f]/70 border border-transparent hover:bg-white/30 hover:text-[#1d1d1f]",
                "disabled:cursor-not-allowed",
              )}
            >
              {getLocaleLabel(entry)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
