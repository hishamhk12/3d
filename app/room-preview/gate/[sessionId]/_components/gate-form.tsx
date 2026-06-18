"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
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

// ─── Approved design system (from the role-selection master screen) ─────────────

// Shared pill button: same height / pill radius / weight / centered alignment as
// the role-selection buttons, with enlarged Arabic text (text-lg). Primary =
// dark charcoal, secondary = project cyan; both use white text for contrast.
const PILL_BTN =
  "flex h-14 w-full items-center justify-center rounded-[32px] text-lg font-bold text-white " +
  "transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed";
const PILL_PRIMARY = "focus-visible:ring-[#192126]/45";
const PILL_SECONDARY = "focus-visible:ring-[var(--brand-cyan)]/60";
const PRIMARY_BTN_STYLE = { background: "#192126", boxShadow: "0 10px 26px rgba(25,33,38,0.28)" } as const;
const SECONDARY_BTN_STYLE = { background: "#00AFD7", boxShadow: "0 10px 26px rgba(0,175,215,0.30)" } as const;

// ─── Small shared pieces ───────────────────────────────────────────────────────

/**
 * Shared shell for the customer / employee form steps. Matches the approved
 * role-selection screen: a clean full-screen white section (no blue background,
 * no floating glass card), centered, scrollable when content is tall, and
 * safe-area aware so the whole QR flow reads as one design system.
 */
function FormShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-white" style={{ minHeight: "100svh" }}>
      <div
        className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-5"
        style={{
          paddingTop: "max(1.75rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The approved onboarding image composition (single source of truth for the
 * role-selection AND customer-choice screens): full-bleed main_pic.png anchored
 * to the bottom so the lower camera UI (progress row, the instruction sentence
 * "صوّر غرفتك، اختر المنتج، وشاهد التصميم قبل التنفيذ.", shutter and camera-switch
 * icon) stays visible, a soft white fade that only softens the bottom edge, and a
 * white content section. Callers pass the heading + buttons as children.
 */
function OnboardingImageLayout({ children }: { children: React.ReactNode }) {
  return (
    // Normal document flow with a one-screen minimum: the button screens fill
    // exactly one viewport (no scroll); the taller form screens grow past it and
    // the page scrolls naturally so every field/button stays reachable.
    <div className="relative flex w-full flex-col bg-white" style={{ minHeight: "100svh" }}>
      {/* Main image — edge to edge, anchored bottom to keep the camera UI visible */}
      <div className="relative w-full shrink-0" style={{ height: "70svh" }}>
        <Image
          src="/room-preview/main_pic.png"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover object-bottom"
        />
        {/* Soft white fade — only below the shutter; does not cover the camera UI */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            height: "10%",
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 45%, rgba(255,255,255,0.8) 80%, #ffffff 100%)",
          }}
        />
      </div>

      {/* White content section — heading + page-specific content */}
      <div
        className="flex flex-1 flex-col items-center bg-white px-5 text-center"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
    </div>
  );
}

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

function SubmitButton({
  label,
  pendingLabel,
  className = `${PILL_BTN} ${PILL_PRIMARY} mt-2`,
}: {
  label: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} style={PRIMARY_BTN_STYLE}>
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <span
            className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          {pendingLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

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
  const router = useRouter();

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

  // ── Role selection — onboarding composition mirroring Figma node 1:604 ──────
  // Structure (top → bottom): full-bleed image (≈66.9% height) → light white fade
  // that overlaps the image bottom and ends in solid white → one Arabic heading →
  // two stacked pill buttons (350×56, radius 32) in the white section (no logo).
  if (step === "role") {
    return (
      <OnboardingImageLayout>
        {/* Heading — ~24px below the fade */}
        <h1 className="pt-6 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          كيف ترغب بالمتابعة؟
        </h1>

        {/* Two stacked buttons — ~18px under the heading, 12px between them */}
        <div className="flex w-full flex-col gap-3 pt-[18px]">
          {/* عميل — charcoal primary. Continues the customer flow (UNCHANGED). */}
          <button
            type="button"
            onClick={() => setStep("customer_type")}
            className={`${PILL_BTN} ${PILL_PRIMARY}`}
            style={PRIMARY_BTN_STYLE}
          >
            {t.customer}
          </button>

          {/* بائع — cyan secondary, identical geometry. Opens /login?type=seller. */}
          <button
            type="button"
            onClick={() => router.push("/login?type=seller")}
            className={`${PILL_BTN} ${PILL_SECONDARY}`}
            style={SECONDARY_BTN_STYLE}
          >
            {t.seller}
          </button>
        </div>
      </OnboardingImageLayout>
    );
  }

  // ── Customer type selection — same onboarding composition as the role screen,
  // only the two buttons change (عميل جديد / عميل حالي). No chip, arrow, or
  // subtitle. ───────────────────────────────────────────────────────────────
  if (step === "customer_type") {
    return (
      <OnboardingImageLayout>
        {/* Heading — identical to the role screen for a continuous look */}
        <h1 className="pt-6 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          كيف ترغب بالمتابعة؟
        </h1>

        {/* Two stacked buttons — same style as the role screen */}
        <div className="flex w-full flex-col gap-3 pt-[18px]">
          {/* عميل جديد — charcoal primary. New customer flow (UNCHANGED). */}
          <button
            type="button"
            onClick={() => setStep("customer_new")}
            className={`${PILL_BTN} ${PILL_PRIMARY}`}
            style={PRIMARY_BTN_STYLE}
          >
            {t.newCustomer}
          </button>

          {/* عميل حالي — cyan secondary. Existing customer flow (UNCHANGED). */}
          <button
            type="button"
            onClick={() => setStep("customer_existing")}
            className={`${PILL_BTN} ${PILL_SECONDARY}`}
            style={SECONDARY_BTN_STYLE}
          >
            {t.existingCustomer}
          </button>
        </div>
      </OnboardingImageLayout>
    );
  }

  // ── New customer form — same onboarding composition; only the white section
  // changes to a form. No chip/back-arrow. ──────────────────────────────────
  if (step === "customer_new") {
    return (
      <OnboardingImageLayout>
        <h1 className="pt-6 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          أدخل بياناتك
        </h1>
        <form
          action={submitGateForm}
          onSubmit={handleSubmit}
          className="w-full max-w-sm mx-auto space-y-4 pt-5 text-start"
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_new" />

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

          <SubmitButton
            label={<>{t.submitBtn} {isRtl ? "←" : "→"}</>}
            pendingLabel={isRtl ? "جاري بدء التجربة..." : "Starting..."}
          />
          <p className="text-center text-xs text-[var(--text-muted)] pt-1">{t.privacyNote}</p>
        </form>
      </OnboardingImageLayout>
    );
  }

  // ── Existing customer lookup form — same onboarding composition; only the
  // white section changes to a form. No chip/back-arrow. ────────────────────
  if (step === "customer_existing") {
    return (
      <OnboardingImageLayout>
        <h1 className="pt-6 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          أدخل رقم جوالك
        </h1>
        <form
          action={submitGateForm}
          onSubmit={handleSubmit}
          className="w-full max-w-sm mx-auto space-y-4 pt-5 text-start"
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_existing" />

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

          <SubmitButton
            label={<>{t.lookupBtn} {isRtl ? "←" : "→"}</>}
            pendingLabel={isRtl ? "جاري..." : "Loading..."}
          />
          <p className="text-center text-xs text-[var(--text-muted)] pt-1">{t.privacyNote}</p>
        </form>
      </OnboardingImageLayout>
    );
  }

  // ── Existing customer confirm screen ──────────────────────────────────────
  if (step === "customer_confirm") {
    const greeting = confirmGreeting ?? "";
    return (
      <FormShell>
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

          <SubmitButton
            label={<>{t.confirmAndStart} {isRtl ? "←" : "→"}</>}
            pendingLabel={isRtl ? "جاري بدء التجربة..." : "Starting..."}
          />
        </form>
      </div>
      </FormShell>
    );
  }

  // ── Employee form ──────────────────────────────────────────────────────────
  if (step === "employee") {
    return (
      <FormShell>
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

          <SubmitButton
            label={<>{t.submitBtn} {isRtl ? "←" : "→"}</>}
            pendingLabel={isRtl ? "جاري بدء التجربة..." : "Starting..."}
          />
          <p className="text-center text-xs text-[var(--text-muted)] pt-1">{t.privacyNote}</p>
        </form>
      </div>
      </FormShell>
    );
  }

  return null;
}
