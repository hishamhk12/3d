"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { selectCustomerRole, submitGateForm } from "../actions";
import { PreviousPreviewsCarousel } from "@/components/room-preview/PreviousPreviewsCarousel";
import RoomPreviewBackButton from "@/components/room-preview/RoomPreviewBackButton";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import { CompanyLogo } from "@/components/CompanyLogo";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

/**
 * Shared login-card layout for every customer gate step (customer type, new
 * customer, existing customer): company logo with a soft breathing halo in the
 * Border Beam colors, then a Magic UI Border Beam card. Logo + halo appear first
 * (0–0.6s; CompanyLogo then adds its own letter stagger and periodic shimmer),
 * the card rises in just after (0.5–1.1s). Entrances are pure CSS so content is
 * visible even before JS hydrates on mobile.
 */
function GateCardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-8 bg-white px-5 py-8">
      <div className="relative flex items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-600 ease-out fill-mode-both motion-reduce:animate-none">
        <div
          aria-hidden
          className="gate-logo-halo pointer-events-none absolute -inset-x-10 -inset-y-8 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,170,64,0.35), rgba(156,64,255,0.22) 55%, transparent)",
          }}
        />
        <CompanyLogo className="relative h-auto w-[200px] text-[var(--brand-navy)]" />
      </div>

      <div className="w-[350px] max-w-full animate-in fade-in slide-in-from-bottom-6 duration-600 delay-500 ease-out fill-mode-both motion-reduce:animate-none">
        <Card className="relative w-full overflow-hidden shadow-sm">
          {children}
          <BorderBeam duration={8} size={100} />
        </Card>
      </div>
    </div>
  );
}

/** Primary card-footer submit button; shows the pending label while the server action runs. */
function CardSubmitButton({ label, pendingLabel }: { label: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
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

  const [step, setStep] = useState<InternalStep>(() => initialStep ?? "customer_type");
  const [rolePending, setRolePending] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
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

  // Shared phone row: compact country dropdown + phone input in one line,
  // styled to match the card's shadcn inputs.
  function renderCountryAndPhone(defaultPhone?: string) {
    return (
      <div className="flex flex-col space-y-1.5">
        <Label htmlFor="gate-phone">{t.phone}</Label>

        {/* Always LTR so dropdown stays left, input stays right */}
        <div className="flex gap-2" dir="ltr">
          {/* Country dropdown — compact, shows "SA +966" */}
          <select
            aria-label={t.phone}
            value={selectedCountry.countryCode}
            onChange={(e) => setSelectedCountry(getCountryByCode(e.target.value))}
            className="h-8 w-[110px] shrink-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
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
          <Input
            id="gate-phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            defaultValue={defaultPhone}
            placeholder={t.phoneLocalPlaceholder}
            className="flex-1"
            dir="ltr"
          />
        </div>
      </div>
    );
  }

  // ── First screen: customer type (عميل جديد / عميل حالي) — Magic UI Border
  // Beam login card. Picking either option records the customer role on the
  // session (selectCustomerRole) and then opens the matching form. ──────────
  if (step === "customer_type") {
    const chooseCustomerType = async (next: "customer_new" | "customer_existing") => {
      if (rolePending) return;
      setRoleError(null);
      setRolePending(true);
      try {
        const selected = await selectCustomerRole(sessionId);
        if (!selected) {
          setRoleError(
            isRtl
              ? "تعذر التحقق من الجلسة. أعد فتح رمز QR وحاول مجددًا."
              : "Could not verify this session. Reopen the QR code and try again.",
          );
          return;
        }
        setStep(next);
      } catch (error) {
        console.error("[room-preview] customer role selection failed", error);
        setRoleError(
          isRtl
            ? "تعذر تسجيل اختيارك. تحقق من الاتصال وحاول مجددًا."
            : "Could not save your choice. Check your connection and try again.",
        );
      } finally {
        setRolePending(false);
      }
    };

    return (
      <GateCardLayout>
        <CardHeader>
          <CardTitle>{isRtl ? "تسجيل الدخول" : "Login"}</CardTitle>
          <CardDescription>
            {isRtl ? "اختر نوع الحساب للمتابعة." : "Choose how you'd like to continue."}
          </CardDescription>
        </CardHeader>
        {roleError ? (
          <CardContent>
            <ErrorBanner message={roleError} />
          </CardContent>
        ) : null}
        <CardFooter className="flex justify-between border-t-0 bg-transparent">
          <Button
            variant="outline"
            disabled={rolePending}
            onClick={() => chooseCustomerType("customer_new")}
          >
            {t.newCustomer}
          </Button>
          <Button
            disabled={rolePending}
            onClick={() => chooseCustomerType("customer_existing")}
          >
            {t.existingCustomer}
          </Button>
        </CardFooter>
      </GateCardLayout>
    );
  }

  // ── New customer form — same login card as the first screen; the card body
  // holds the form. `contents` lets the form's children sit directly in the
  // card's flex layout while keeping the footer submit inside the <form>. ────
  if (step === "customer_new") {
    return (
      <GateCardLayout>
        <form action={submitGateForm} onSubmit={handleSubmit} className="contents">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_new" />

          <CardHeader>
            <CardTitle>{t.newCustomer}</CardTitle>
            <CardDescription>
              {isRtl ? "أدخل بياناتك لبدء التجربة." : "Enter your details to start the experience."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid w-full items-center gap-4">
              {error && <ErrorBanner message={error} />}
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="gate-name">{t.fullName}</Label>
                <Input
                  id="gate-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  defaultValue={initialName}
                  placeholder={t.namePlaceholder}
                  dir="auto"
                />
              </div>
              {renderCountryAndPhone(initialPhone)}
              <p className="text-xs text-muted-foreground">{t.privacyNote}</p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t-0 bg-transparent">
            <Button type="button" variant="outline" onClick={() => setStep("customer_type")}>
              {isRtl ? "رجوع" : "Back"}
            </Button>
            <CardSubmitButton
              label={t.submitBtn}
              pendingLabel={isRtl ? "جاري بدء التجربة..." : "Starting..."}
            />
          </CardFooter>
        </form>
      </GateCardLayout>
    );
  }

  // ── Existing customer lookup form — same login card as the first screen. ──
  if (step === "customer_existing") {
    return (
      <GateCardLayout>
        <form action={submitGateForm} onSubmit={handleSubmit} className="contents">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="flow" value="customer_existing" />

          <CardHeader>
            <CardTitle>{t.existingCustomer}</CardTitle>
            <CardDescription>
              {isRtl ? "أدخل رقم جوالك للمتابعة." : "Enter your phone number to continue."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid w-full items-center gap-4">
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
              <p className="text-xs text-muted-foreground">{t.privacyNote}</p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t-0 bg-transparent">
            <Button type="button" variant="outline" onClick={() => setStep("customer_type")}>
              {isRtl ? "رجوع" : "Back"}
            </Button>
            <CardSubmitButton
              label={t.lookupBtn}
              pendingLabel={isRtl ? "جاري..." : "Loading..."}
            />
          </CardFooter>
        </form>
      </GateCardLayout>
    );
  }

  // ── Existing customer confirm screen ──────────────────────────────────────
  if (step === "customer_confirm") {
    const greeting = confirmGreeting ?? "";

    // Display-only: the carousel below just shows the customer's last visits.
    // Nothing here is submitted with the form or affects the session.
    const exps = previousExperiences.filter((e) => e.resultImageUrl);
    const items = exps.map((e) => ({
      id: e.id,
      src: e.resultImageUrl!,
      alt: locale === "ar" ? "آخر معاينة" : "Previous preview",
      title: e.productName,
    }));
    const safeIndex = exps.length > 0 ? Math.min(expIndex, exps.length - 1) : 0;
    const cur = exps[safeIndex];

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

          {/* Previous render results — mobile 3D carousel over the customer's
              real last-3 previews. Display only; selection here is never submitted. */}
          {exps.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-cyan)] uppercase mb-4 text-center">
                {locale === "ar" ? "آخر معايناتك" : "Your previous previews"}
              </p>

              <PreviousPreviewsCarousel items={items} index={safeIndex} onIndexChange={setExpIndex} />

              {/* Current item's product name — same placement as before */}
              {cur?.productName && (
                <p className="mt-3 text-sm font-medium text-center text-[var(--text-secondary)] truncate px-4">
                  {cur.productName}
                </p>
              )}
            </div>
          )}

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
      <FormShell onBack={() => setStep("customer_type")} backLabel={isRtl ? "رجوع" : "Back"}>
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
