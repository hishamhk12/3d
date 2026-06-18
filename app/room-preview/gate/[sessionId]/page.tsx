import { GateForm } from "./_components/gate-form";
import { cookies } from "next/headers";
import { isSupportedLocale, LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLatestCustomerExperiences } from "@/lib/room-preview/customer-service";
import type { GateFormStep, PreviousExperience } from "./_components/gate-form";

type GatePageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{
    error?: string;
    lang?: string;
    // Step control (set by server redirects after form submission)
    step?: string;
    // customer_confirm params
    greeting?: string;
    cid?: string;
    // Form prefill after validation error or not_found redirect
    name?: string;
    countryCode?: string;
    phone?: string;
    // customer_existing not-found flag
    notFound?: string;
  }>;
};

export default async function GatePage({ params, searchParams }: GatePageProps) {
  const { sessionId } = await params;
  const { error, lang, step, greeting, cid, name, countryCode, phone, notFound } =
    await searchParams;

  const cookieStore = await cookies();
  const locale = isSupportedLocale(lang)
    ? lang
    : normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const t = dictionaries[locale];

  const VALID_STEPS = ["customer_new", "customer_existing", "customer_confirm", "employee"] as const;
  const validStep: GateFormStep | undefined = (VALID_STEPS as readonly string[]).includes(step ?? "")
    ? (step as GateFormStep)
    : undefined;

  // Fetch previous experiences for the confirm screen
  let previousExperiences: PreviousExperience[] = [];
  if (validStep === "customer_confirm" && cid) {
    const rows = await getLatestCustomerExperiences(cid, 3);
    previousExperiences = rows
      .filter((r) => r.resultImageUrl)
      .map((r) => ({
        id: r.id,
        resultImageUrl: r.resultImageUrl,
        productName: r.productName,
      }));
  }

  return (
    <main
      className="relative min-h-screen bg-white text-[var(--text-primary)]"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
    >
      {/* GateForm owns its own layout per step. Every step renders a full-screen
          white layer (the approved role-selection visual system) — no blue
          background, no glass card. */}
      <GateForm
        sessionId={sessionId}
        locale={locale}
        t={t.gate}
        initialStep={validStep}
        confirmCustomerId={validStep === "customer_confirm" ? cid : undefined}
        confirmGreeting={validStep === "customer_confirm" ? greeting : undefined}
        notFound={notFound === "1"}
        initialName={name}
        initialCountryCode={countryCode}
        initialPhone={phone}
        previousExperiences={previousExperiences}
        error={error}
      />
    </main>
  );
}
