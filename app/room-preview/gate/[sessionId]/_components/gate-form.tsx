"use client";

import { type MouseEvent, useState } from "react";
import { submitGateForm } from "../actions";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { dictionaries } from "@/lib/i18n/dictionaries";

type GateT = typeof dictionaries["en"]["gate"];

interface GateFormProps {
  sessionId: string;
  locale: "ar" | "en";
  t: GateT;
  initialRole?: "customer" | "employee";
  initialName?: string;
  error?: string;
}

type Role = "customer" | "employee";

function getGatePath(sessionId: string, locale: "ar" | "en", role?: Role) {
  const path = `/room-preview/gate/${encodeURIComponent(sessionId)}`;
  const params = new URLSearchParams({ lang: locale });
  if (role) params.set("role", role);
  return `${path}?${params}`;
}

export function GateForm({ sessionId, locale, t, initialRole, initialName, error }: GateFormProps) {
  const [role, setRole] = useState<Role | null>(initialRole ?? null);
  const isRtl = locale === "ar";

  function selectRole(nextRole: Role, event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setRole(nextRole);
  }

  function clearRole(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setRole(null);
  }

  function handleSubmit() {
    console.info("[room-preview] gate_submit_prevent_default_confirmed", { sessionId, role });
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "gate_submit_prevent_default_confirmed",
      level: "info",
      metadata: {
        preventDefaultApplied: false,
        reason: "native_next_server_action_submit",
        role,
      },
    });
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "gate_submit_navigation_blocked",
      level: "info",
      metadata: {
        blocked: false,
        reason: "server_action_connects_before_redirect",
        role,
        submitMode: "native_next_server_action",
      },
    });
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      {!role ? (
        <div>
          <p className="text-center text-sm font-medium text-[var(--text-secondary)] mb-6">
            {t.whoAreYou}
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* Customer card */}
            <a
              href={getGatePath(sessionId, locale, "customer")}
              onClick={(e) => selectRole("customer", e)}
              className="flex flex-col items-center gap-3 py-6 px-4 rounded-2xl cursor-pointer transition-all border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-surface-2)] active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-2xl bg-[var(--brand-cyan)]/10 border border-[var(--brand-cyan)]/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-[var(--brand-cyan)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-[var(--text-primary)] text-sm">{t.customer}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t.customerDesc}</p>
              </div>
            </a>

            {/* Employee card */}
            <a
              href={getGatePath(sessionId, locale, "employee")}
              onClick={(e) => selectRole("employee", e)}
              className="flex flex-col items-center gap-3 py-6 px-4 rounded-2xl cursor-pointer transition-all border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-surface-2)] active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-2xl bg-[var(--brand-cyan)]/10 border border-[var(--brand-cyan)]/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-[var(--brand-cyan)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-[var(--text-primary)] text-sm">{t.employee}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t.employeeDesc}</p>
              </div>
            </a>
          </div>
        </div>
      ) : (
        <form action={submitGateForm} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="role" value={role} />

          {/* Role pill + back button */}
          <div className="flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <a
              href={getGatePath(sessionId, locale)}
              onClick={clearRole}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label={t.goBack}
            >
              <svg className="w-4 h-4 rtl:scale-x-[-1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </a>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              role === "customer"
                ? "bg-[var(--brand-cyan)]/10 border-[var(--brand-cyan)]/25 text-[var(--brand-cyan)]"
                : "bg-[var(--brand-navy)]/10 border-[var(--brand-navy)]/25 text-[var(--brand-navy)] dark:text-[var(--brand-cyan)]"
            }`}>
              {role === "customer" ? t.customer : t.employee}
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-500/10 dark:border-red-500/25 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Full name */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
              {t.fullName} <span className="text-[var(--brand-gold)]">*</span>
            </label>
            <input
              name="name"
              type="text"
              autoComplete="name"
              required
              defaultValue={initialName}
              placeholder={t.namePlaceholder}
              dir="auto"
              className="ds-input"
            />
          </div>

          {/* Role-specific field */}
          {role === "customer" ? (
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                {t.phone} <span className="text-[var(--brand-gold)]">*</span>
              </label>
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                required
                placeholder={t.phonePlaceholder}
                className="ds-input"
                dir="ltr"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                {t.employeeCode} <span className="text-[var(--brand-gold)]">*</span>
              </label>
              <input
                name="employeeCode"
                type="text"
                autoComplete="off"
                required
                placeholder={t.employeeCodePlaceholder}
                className="ds-input"
                dir="ltr"
              />
            </div>
          )}

          <button type="submit" className="btn-cta w-full mt-2">
            {t.submitBtn} {isRtl ? "←" : "→"}
          </button>

          <p className="text-center text-xs text-[var(--text-muted)] pt-1">
            {t.privacyNote}
          </p>
        </form>
      )}
    </div>
  );
}
