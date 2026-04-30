"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { submitGateForm } from "../actions";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import {
  COUNTRY_DIAL_OPTIONS,
  DEFAULT_COUNTRY,
  getCountryByCode,
} from "@/lib/room-preview/country-dial-options";
import type { CountryDialOption } from "@/lib/room-preview/country-dial-options";
import type { dictionaries } from "@/lib/i18n/dictionaries";

type GateT = typeof dictionaries["en"]["gate"];

export type GateFormStep =
  | "customer_new"
  | "customer_existing"
  | "customer_confirm"
  | "employee";

export type PreviousExperience = {
  id: string;
  resultImageUrl: string | null;
  productName: string | null;
};

// Internal step includes client-only transitions
type InternalStep =
  | "role"
  | "customer_type"
  | GateFormStep;

interface GateFormProps {
  sessionId: string;
  locale: "ar" | "en";
  t: GateT;
  // Set by server redirects
  initialStep?: GateFormStep;
  // customer_confirm
  confirmCustomerId?: string;
  confirmGreeting?: string;
  // Previous render results for returning customer
  previousExperiences?: PreviousExperience[];
  // customer_existing + notFound
  notFound?: boolean;
  // Prefill after error redirects
  initialName?: string;
  initialCountryCode?: string;
  initialPhone?: string;
  error?: string;
}

// ─── Small shared pieces ───────────────────────────────────────────────────────

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
    >
      <svg className="w-4 h-4 rtl:scale-x-[-1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

function RolePill({ label, color = "cyan" }: { label: string; color?: "cyan" | "navy" }) {
  const colors =
    color === "cyan"
      ? "bg-[var(--brand-cyan)]/10 border-[var(--brand-cyan)]/25 text-[var(--brand-cyan)]"
      : "bg-[var(--brand-navy)]/10 border-[var(--brand-navy)]/25 text-[var(--brand-navy)] dark:text-[var(--brand-cyan)]";
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${colors}`}>
      {label}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-500/10 dark:border-red-500/25 dark:text-red-300">
      {message}
    </div>
  );
}

function SectionCard({
  onClick,
  icon,
  label,
  desc,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-3 py-6 px-4 rounded-2xl cursor-pointer transition-all border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-surface-2)] active:scale-[0.98]"
    >
      <div className="w-12 h-12 rounded-2xl bg-[var(--brand-cyan)]/10 border border-[var(--brand-cyan)]/20 flex items-center justify-center text-[var(--brand-cyan)]">
        {icon}
      </div>
      <div className="text-center">
        <p className="font-semibold text-[var(--text-primary)] text-sm">{label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>
      </div>
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const PersonIcon = (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const EmployeeIcon = (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const NewPersonIcon = (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
  </svg>
);

const ReturningPersonIcon = (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
  </svg>
);

// ─── Main component ────────────────────────────────────────────────────────────

export function GateForm({
  sessionId,
  locale,
  t,
  initialStep,
  confirmCustomerId,
  confirmGreeting,
  previousExperiences = [],
  notFound,
  initialName,
  initialCountryCode,
  initialPhone,
  error,
}: GateFormProps) {
  const isRtl = locale === "ar";

  const [step, setStep] = useState<InternalStep>(() => initialStep ?? "role");
  const [selectedCountry, setSelectedCountry] = useState<CountryDialOption>(() =>
    initialCountryCode ? getCountryByCode(initialCountryCode) : DEFAULT_COUNTRY,
  );
  const [expIndex, setExpIndex] = useState(0);

  function handleSubmit() {
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "gate_submit_prevent_default_confirmed",
      level: "info",
      metadata: {
        step,
        preventDefaultApplied: false,
        reason: "native_next_server_action_submit",
      },
    });
  }

  // Shared phone row: compact country dropdown + phone input in one line
  function renderCountryAndPhone(defaultPhone?: string) {
    return (
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
          {t.phone} <span className="text-[var(--brand-gold)]">*</span>
        </label>

        {/* Always LTR so dropdown stays left, input stays right */}
        <div className="flex gap-2" dir="ltr">
          {/* Country dropdown — compact, shows "SA +966" */}
          <select
            value={selectedCountry.countryCode}
            onChange={(e) => setSelectedCountry(getCountryByCode(e.target.value))}
            className="ds-input shrink-0 px-2 text-sm"
            style={{ width: "130px" }}
            dir="ltr"
          >
            {COUNTRY_DIAL_OPTIONS.map((c) => (
              <option key={c.countryCode} value={c.countryCode}>
                {c.countryCode} {c.dialCode}
              </option>
            ))}
          </select>
          <input type="hidden" name="countryCode" value={selectedCountry.countryCode} />
          <input type="hidden" name="dialCode" value={selectedCountry.dialCode} />

          {/* Phone number — local digits only */}
          <input
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            defaultValue={defaultPhone}
            placeholder={t.phoneLocalPlaceholder}
            className="ds-input flex-1 min-w-0"
            dir="ltr"
          />
        </div>
      </div>
    );
  }

  // ── Role selection ────────────────────────────────────────────────────────
  if (step === "role") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <p className="text-center text-sm font-medium text-[var(--text-secondary)] mb-6">
          {t.whoAreYou}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <SectionCard
            onClick={() => setStep("customer_type")}
            icon={PersonIcon}
            label={t.customer}
            desc={t.customerDesc}
          />
          <SectionCard
            onClick={() => setStep("employee")}
            icon={EmployeeIcon}
            label={t.employee}
            desc={t.employeeDesc}
          />
        </div>
      </div>
    );
  }

  // ── Customer type selection ───────────────────────────────────────────────
  if (step === "customer_type") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <div className="flex items-center gap-2 mb-6 rtl:flex-row-reverse">
          <BackBtn onClick={() => setStep("role")} />
          <RolePill label={t.customer} />
        </div>
        <p className="text-center text-sm font-medium text-[var(--text-secondary)] mb-6">
          {t.newOrExisting}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <SectionCard
            onClick={() => setStep("customer_new")}
            icon={NewPersonIcon}
            label={t.newCustomer}
            desc={t.newCustomerDesc}
          />
          <SectionCard
            onClick={() => setStep("customer_existing")}
            icon={ReturningPersonIcon}
            label={t.existingCustomer}
            desc={t.existingCustomerDesc}
          />
        </div>
      </div>
    );
  }

  // ── New customer form ─────────────────────────────────────────────────────
  if (step === "customer_new") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <form action={submitGateForm} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_new" />

          <div className="flex items-center gap-2 mb-2 rtl:flex-row-reverse">
            <BackBtn onClick={() => setStep("customer_type")} />
            <RolePill label={t.newCustomer} />
          </div>

          {error && <ErrorBanner message={error} />}

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

          {renderCountryAndPhone(initialPhone)}

          <button type="submit" className="btn-cta w-full mt-2">
            {t.submitBtn} {isRtl ? "←" : "→"}
          </button>
          <p className="text-center text-xs text-[var(--text-muted)] pt-1">{t.privacyNote}</p>
        </form>
      </div>
    );
  }

  // ── Existing customer lookup form ─────────────────────────────────────────
  if (step === "customer_existing") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <form action={submitGateForm} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_existing" />

          <div className="flex items-center gap-2 mb-2 rtl:flex-row-reverse">
            <BackBtn onClick={() => setStep("customer_type")} />
            <RolePill label={t.existingCustomer} />
          </div>

          {/* Not-found banner */}
          {notFound && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm dark:bg-amber-500/10 dark:border-amber-500/25">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {t.existingCustomerNotFound}
              </p>
              <button
                type="button"
                onClick={() => setStep("customer_new")}
                className="mt-2 text-xs font-semibold underline text-amber-700 dark:text-amber-400"
              >
                {t.switchToNewCustomer}
              </button>
            </div>
          )}

          {error && !notFound && <ErrorBanner message={error} />}

          {renderCountryAndPhone(initialPhone)}

          <button type="submit" className="btn-cta w-full mt-2">
            {t.lookupBtn} {isRtl ? "←" : "→"}
          </button>
          <p className="text-center text-xs text-[var(--text-muted)] pt-1">{t.privacyNote}</p>
        </form>
      </div>
    );
  }

  // ── Existing customer confirm screen ──────────────────────────────────────
  if (step === "customer_confirm") {
    const greeting = confirmGreeting ?? "";
    return (
      <div className="w-full max-w-sm mx-auto">
        <form action={submitGateForm} onSubmit={handleSubmit}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_confirm" />
          <input type="hidden" name="customerId" value={confirmCustomerId ?? ""} />
          <input type="hidden" name="name" value={greeting} />

          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="font-display text-xl font-semibold text-[var(--text-primary)]">
              {t.greetingTitle.replace("{name}", greeting)}
            </h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{t.greetingSubtitle}</p>
          </div>

          {/* Previous render results — carousel style matching ProductStep */}
          {(() => {
            const exps = previousExperiences.filter((e) => e.resultImageUrl);
            if (exps.length === 0) return null;
            const cur = exps[expIndex]!;
            const canPrev = expIndex > 0;
            const canNext = expIndex < exps.length - 1;

            const arrowClass = (active: boolean) =>
              `absolute z-20 flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 ${
                active
                  ? "border-[rgba(0,175,215,0.35)] bg-[rgba(0,175,215,0.12)] text-[var(--brand-cyan)] shadow-[0_0_14px_rgba(0,175,215,0.25)] hover:bg-[rgba(0,175,215,0.22)] hover:shadow-[0_0_20px_rgba(0,175,215,0.40)] active:scale-90"
                  : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] opacity-25 cursor-not-allowed"
              }`;

            return (
              <div className="mb-6">
                <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-cyan)] uppercase mb-4 text-center">
                  {locale === "ar" ? "آخر معايناتك" : "Your previous previews"}
                </p>

                {/* Hero image + arrows */}
                <div className="relative flex h-[320px] items-center justify-center">
                  {/* Glow */}
                  <div className="pointer-events-none absolute inset-0 -z-10 mx-auto max-w-[180px] rounded-[100%] bg-[var(--brand-cyan)]/10 opacity-70 blur-[50px]" />

                  {/* Left arrow */}
                  <button
                    type="button"
                    onClick={() => setExpIndex((i) => Math.max(0, i - 1))}
                    disabled={!canPrev}
                    className={`${arrowClass(canPrev)} left-0`}
                  >
                    <ChevronLeft className="size-5" />
                  </button>

                  {/* Image */}
                  <div className="mx-10 h-full w-full overflow-hidden rounded-2xl">
                    <img
                      key={cur.id}
                      src={cur.resultImageUrl!}
                      alt={cur.productName ?? ""}
                      className="h-full w-full object-cover"
                    />
                  </div>

                  {/* Right arrow */}
                  <button
                    type="button"
                    onClick={() => setExpIndex((i) => Math.min(exps.length - 1, i + 1))}
                    disabled={!canNext}
                    className={`${arrowClass(canNext)} right-0`}
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>

                {/* Product name */}
                {cur.productName && (
                  <p className="mt-3 text-sm font-medium text-center text-[var(--text-secondary)] truncate px-4">
                    {cur.productName}
                  </p>
                )}

                {/* Dot indicators */}
                {exps.length > 1 && (
                  <div className="mt-3 flex justify-center gap-1.5">
                    {exps.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setExpIndex(i)}
                        className={`h-1.5 rounded-full transition-all duration-200 ${
                          i === expIndex
                            ? "w-4 bg-[var(--brand-cyan)]"
                            : "w-1.5 bg-[var(--border-strong)]"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <button type="submit" className="btn-cta w-full">
            {t.confirmAndStart} {isRtl ? "←" : "→"}
          </button>
        </form>
      </div>
    );
  }

  // ── Employee form ──────────────────────────────────────────────────────────
  if (step === "employee") {
    return (
      <div className="w-full max-w-sm mx-auto">
        <form action={submitGateForm} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="employee" />

          <div className="flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <BackBtn onClick={() => setStep("role")} />
            <RolePill label={t.employee} color="navy" />
          </div>

          {error && <ErrorBanner message={error} />}

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

          {/* Employee code */}
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

          <button type="submit" className="btn-cta w-full mt-2">
            {t.submitBtn} {isRtl ? "←" : "→"}
          </button>
          <p className="text-center text-xs text-[var(--text-muted)] pt-1">{t.privacyNote}</p>
        </form>
      </div>
    );
  }

  return null;
}
