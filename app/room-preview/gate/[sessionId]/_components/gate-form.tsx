"use client";

import { useState } from "react";
import { submitGateForm } from "../actions";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import type { dictionaries } from "@/lib/i18n/dictionaries";

type GateT = typeof dictionaries["en"]["gate"];

interface GateFormProps {
  sessionId: string;
  locale: "ar" | "en";
  t: GateT;
  /** Pre-selected role from searchParams (preserves state after a failed submit). */
  initialRole?: "customer" | "employee";
  initialName?: string;
  error?: string;
}

type Role = "customer" | "employee";

export function GateForm({ sessionId, locale, t, initialRole, initialName, error }: GateFormProps) {
  const [role, setRole] = useState<Role | null>(initialRole ?? null);
  const isRtl = locale === "ar";

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Step 1 — Role selection */}
      {!role ? (
        <div className="space-y-4">
          <p className="text-center text-sm font-medium text-[#0a1f3d]/70 mb-6">
            {t.whoAreYou}
          </p>

          {/* Customer card */}
          <AnimatedButton
            onClick={() => setRole("customer")}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-[#0a1f3d]/15 bg-white hover:border-[#0a1f3d]/40 hover:bg-[#0a1f3d]/5 transition-all text-start rtl:flex-row-reverse"
            glowColor="rgba(10, 31, 61, 0.1)"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-[#0a1f3d]">{t.customer}</p>
              <p className="text-xs text-[#0a1f3d]/50 mt-0.5">{t.customerDesc}</p>
            </div>
          </AnimatedButton>

          {/* Employee card */}
          <AnimatedButton
            onClick={() => setRole("employee")}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-[#0a1f3d]/15 bg-white hover:border-[#0a1f3d]/40 hover:bg-[#0a1f3d]/5 transition-all text-start rtl:flex-row-reverse"
            glowColor="rgba(10, 31, 61, 0.1)"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-[#0a1f3d]">{t.employee}</p>
              <p className="text-xs text-[#0a1f3d]/50 mt-0.5">{t.employeeDesc}</p>
            </div>
          </AnimatedButton>
        </div>
      ) : (
        /* Step 2 — Details form */
        <form action={submitGateForm} className="space-y-4">
          {/* Hidden fields */}
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="role" value={role} />

          {/* Role pill + back button */}
          <div className="flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <AnimatedButton
              type="button"
              onClick={() => setRole(null)}
              className="p-1.5 rounded-lg hover:bg-[#0a1f3d]/10 text-[#0a1f3d]/50 hover:text-[#0a1f3d] transition-colors"
              aria-label={t.goBack}
              glowColor="rgba(10, 31, 61, 0.2)"
            >
              {/* Arrow flips direction in RTL */}
              <svg className="w-4 h-4 rtl:scale-x-[-1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </AnimatedButton>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              role === "customer"
                ? "bg-blue-100 text-blue-700"
                : "bg-indigo-100 text-indigo-700"
            }`}>
              {role === "customer" ? t.customer : t.employee}
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Full name */}
          <div>
            <label className="block text-sm font-medium text-[#0a1f3d] mb-1.5">
              {t.fullName} <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              type="text"
              autoComplete="name"
              required
              defaultValue={initialName}
              placeholder={t.namePlaceholder}
              dir="auto"
              className="w-full px-4 py-3 rounded-xl border border-[#0a1f3d]/20 bg-white text-[#0a1f3d] placeholder-[#0a1f3d]/30 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 focus:border-transparent"
            />
          </div>

          {/* Role-specific field */}
          {role === "customer" ? (
            <div>
              <label className="block text-sm font-medium text-[#0a1f3d] mb-1.5">
                {t.phone} <span className="text-red-500">*</span>
              </label>
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                required
                placeholder={t.phonePlaceholder}
                className="w-full px-4 py-3 rounded-xl border border-[#0a1f3d]/20 bg-white text-[#0a1f3d] placeholder-[#0a1f3d]/30 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 focus:border-transparent"
                dir="ltr"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[#0a1f3d] mb-1.5">
                {t.employeeCode} <span className="text-red-500">*</span>
              </label>
              <input
                name="employeeCode"
                type="text"
                autoComplete="off"
                required
                placeholder={t.employeeCodePlaceholder}
                className="w-full px-4 py-3 rounded-xl border border-[#0a1f3d]/20 bg-white text-[#0a1f3d] placeholder-[#0a1f3d]/30 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 focus:border-transparent"
                dir="ltr"
              />
            </div>
          )}

          <AnimatedButton
            type="submit"
            className="w-full py-3 px-4 rounded-xl bg-[#0a1f3d] hover:bg-[#0a1f3d]/90 active:bg-[#0a1f3d] text-white text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/50 focus:ring-offset-2 mt-2"
          >
            {t.submitBtn} {isRtl ? "←" : "→"}
          </AnimatedButton>

          <p className="text-center text-xs text-[#0a1f3d]/40 pt-1">
            {t.privacyNote}
          </p>
        </form>
      )}
    </div>
  );
}
