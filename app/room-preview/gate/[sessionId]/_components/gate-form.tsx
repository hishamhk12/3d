"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { selectCustomerRole, submitGateForm } from "../actions";
import { VerticalImageStack } from "@/components/ui/vertical-image-stack";
import RoomPreviewBackButton from "@/components/room-preview/RoomPreviewBackButton";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import { dismissMobileKeyboard } from "@/hooks/use-dismiss-keyboard-on-enter";
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

/**
 * Shared shell for the customer / employee form steps. Matches the approved
 * role-selection screen: a clean full-screen white section (no blue background,
 * no floating glass card), centered, scrollable when content is tall, and
 * safe-area aware so the whole QR flow reads as one design system.
 */
function FormShell({ children, onBack, backLabel = "Back" }: { children: React.ReactNode; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-white" style={{ minHeight: "100svh" }}>
      {onBack ? (
        <RoomPreviewBackButton
          ariaLabel={backLabel}
          onClick={onBack}
          size={40}
          className="z-50"
          style={{ top: "max(16px, env(safe-area-inset-top))", left: 16 }}
        />
      ) : null}
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
/**
 * Two variants share this single image/fade implementation:
 *  • "selection" (role, customer_type): tall 70svh image, small bottom fade.
 *  • "form" (customer_new, customer_existing): shorter, responsive image height
 *    (clamp) + a larger fade that starts earlier, so the whole form fits in one
 *    mobile viewport (no scroll) while the camera-interface look is preserved.
 * `imageHeight` lets a caller fine-tune the form height per step.
 */
function OnboardingImageLayout({
  children,
  variant = "selection",
  imageHeight,
  onBack,
  backLabel = "Back",
}: {
  children: React.ReactNode;
  variant?: "selection" | "form";
  imageHeight?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  const isForm = variant === "form";
  const height = imageHeight ?? (isForm ? "clamp(230px, 42svh, 400px)" : "70svh");
  const fade = isForm
    ? {
        // Larger fade, begins earlier — hides the shorter-image cut, ends in white.
        height: "30%",
        background:
          "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 38%, rgba(255,255,255,0.82) 74%, #ffffff 100%)",
      }
    : {
        height: "22%",
        background:
          "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.35) 45%, rgba(255,255,255,0.75) 72%, #ffffff 100%)",
      };
  return (
    // Normal document flow with a one-screen minimum: screens fill exactly one
    // viewport (no scroll in the resting state); when the keyboard opens the page
    // scrolls naturally (no fixed positioning, no overflow lock).
    <div className="relative flex w-full flex-col bg-white" style={{ minHeight: "100svh" }}>
      {onBack ? (
        <RoomPreviewBackButton
          ariaLabel={backLabel}
          onClick={onBack}
          size={40}
          className="z-50"
          style={{ top: "max(16px, env(safe-area-inset-top))", left: 16 }}
        />
      ) : null}
      {/* Main image — edge to edge, anchored bottom to keep the camera UI visible */}
      <div className="relative w-full shrink-0" style={{ height }}>
        <Image
          src="/room-preview/main_pic.png"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover object-bottom"
        />
        {/* Soft white fade — softens the bottom edge into the white content area */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={fade}
        />
      </div>

      {/* White content section — heading + page-specific content */}
      <div
        className="flex flex-1 flex-col items-center bg-white px-5 text-center"
        style={{
          paddingBottom: isForm
            ? "max(1.25rem, env(safe-area-inset-bottom))"
            : "max(2rem, env(safe-area-inset-bottom))",
        }}
      >
        {children}
      </div>
    </div>
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
  className = "mt-2",
}: {
  label: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <MobileActionButton type="submit" variant="light" loading={pending} className={className}>
      {pending ? pendingLabel : label}
    </MobileActionButton>
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
    // onSubmit only fires once the browser's native (HTML5 `required`) validation
    // passes — on client-validation failure the browser keeps the invalid field
    // focused and never submits, so we never blur it. Here, right before the server
    // action soft-navigates to the upload step, drop focus from the active field so
    // iPhone Safari closes the keyboard and the next page opens at full height.
    dismissMobileKeyboard();
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
            className="ds-input shrink-0 min-h-[48px] px-2 text-sm"
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
            className="ds-input min-h-[48px] flex-1 min-w-0"
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

        {/* Two stacked buttons — Figma node 5239:2890 component, 10px between them */}
        <div className="flex w-full flex-col gap-[10px] pt-[18px]">
          {/* عميل — primary/recommended action (project brand #192126). UNCHANGED logic. */}
          <MobileActionButton
            variant="light"
            onClick={async () => {
              await selectCustomerRole(sessionId);
              setStep("customer_type");
            }}
          >
            {t.customer}
          </MobileActionButton>

          {/* بائع — secondary choice (#0088FF). Opens /login?type=seller. UNCHANGED logic. */}
          <MobileActionButton
            variant="blue"
            onClick={() => router.push("/login?type=seller")}
          >
            {t.seller}
          </MobileActionButton>
        </div>
      </OnboardingImageLayout>
    );
  }

  // ── Customer type selection — same onboarding composition as the role screen,
  // only the two buttons change (عميل جديد / عميل حالي). No chip, arrow, or
  // subtitle. ───────────────────────────────────────────────────────────────
  if (step === "customer_type") {
    return (
      <OnboardingImageLayout onBack={() => setStep("role")} backLabel={isRtl ? "رجوع" : "Back"}>
        {/* Heading — identical to the role screen for a continuous look */}
        <h1 className="pt-6 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          كيف ترغب بالمتابعة؟
        </h1>

        {/* Two stacked buttons — same Figma component as the role screen, 10px gap */}
        <div className="flex w-full flex-col gap-[10px] pt-[18px]">
          {/* عميل جديد — primary/recommended action (project brand #192126). UNCHANGED logic. */}
          <MobileActionButton
            variant="light"
            onClick={() => setStep("customer_new")}
          >
            {t.newCustomer}
          </MobileActionButton>

          {/* عميل حالي — secondary choice (#0088FF). Existing customer flow. UNCHANGED logic. */}
          <MobileActionButton
            variant="blue"
            onClick={() => setStep("customer_existing")}
          >
            {t.existingCustomer}
          </MobileActionButton>
        </div>
      </OnboardingImageLayout>
    );
  }

  // ── New customer form — same onboarding composition; only the white section
  // changes to a form. No chip/back-arrow. ──────────────────────────────────
  if (step === "customer_new") {
    return (
      <OnboardingImageLayout
        variant="form"
        imageHeight="clamp(220px, 40svh, 380px)"
        onBack={() => setStep("customer_type")}
        backLabel={isRtl ? "رجوع" : "Back"}
      >
        <h1 className="pt-4 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          أدخل بياناتك
        </h1>
        <form
          action={submitGateForm}
          onSubmit={handleSubmit}
          className="w-full max-w-sm mx-auto space-y-3 pt-4 text-start"
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
              className="ds-input min-h-[48px]"
            />
          </div>

          {renderCountryAndPhone(initialPhone)}

          <SubmitButton
            label={t.submitBtn}
            pendingLabel={isRtl ? "جاري بدء التجربة..." : "Starting..."}
          />
          <p className="text-center text-xs text-[var(--text-muted)] pt-0.5">{t.privacyNote}</p>
        </form>
      </OnboardingImageLayout>
    );
  }

  // ── Existing customer lookup form — same onboarding composition; only the
  // white section changes to a form. No chip/back-arrow. ────────────────────
  if (step === "customer_existing") {
    return (
      <OnboardingImageLayout
        variant="form"
        imageHeight="clamp(240px, 44svh, 410px)"
        onBack={() => setStep("customer_type")}
        backLabel={isRtl ? "رجوع" : "Back"}
      >
        <h1 className="pt-4 font-display text-2xl font-extrabold leading-tight text-[#192126]">
          أدخل رقم جوالك
        </h1>
        <form
          action={submitGateForm}
          onSubmit={handleSubmit}
          className="w-full max-w-sm mx-auto space-y-3 pt-4 text-start"
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
            label={t.lookupBtn}
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
      <FormShell onBack={() => setStep("customer_existing")} backLabel={isRtl ? "رجوع" : "Back"}>
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

          {/* Previous render results — 21st.dev VerticalImageStack (replaces the
              old arrow carousel; same data, same order, no other UI changes) */}
          {(() => {
            const exps = previousExperiences.filter((e) => e.resultImageUrl);
            if (exps.length === 0) return null;
            const items = exps.map((e, i) => ({
              id: e.id || String(i),
              src: e.resultImageUrl!,
              alt: locale === "ar" ? "آخر معاينة" : "Previous preview",
              title: e.productName,
            }));
            const cur = exps[Math.min(expIndex, exps.length - 1)];

            return (
              <div className="mb-6">
                <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-cyan)] uppercase mb-4 text-center">
                  {locale === "ar" ? "آخر معايناتك" : "Your previous previews"}
                </p>

                <VerticalImageStack items={items} initialIndex={0} onIndexChange={setExpIndex} />

                {/* Current item's product name — same placement as the old carousel */}
                {cur?.productName && (
                  <p className="mt-3 text-sm font-medium text-center text-[var(--text-secondary)] truncate px-4">
                    {cur.productName}
                  </p>
                )}
              </div>
            );
          })()}

          <SubmitButton
            label={t.confirmAndStart}
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
      <FormShell onBack={() => setStep("role")} backLabel={isRtl ? "رجوع" : "Back"}>
      <div className="w-full max-w-sm mx-auto">
        <form action={submitGateForm} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="employee" />

          <div className="flex items-center gap-2 mb-6 rtl:flex-row-reverse">
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
            label={t.submitBtn}
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
