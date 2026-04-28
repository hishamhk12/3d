import { GateForm } from "./_components/gate-form";
import { cookies } from "next/headers";
import { isSupportedLocale, LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CompanyLogo } from "@/components/CompanyLogo";

type GatePageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{
    error?: string;
    lang?: string;
    role?: string;
    name?: string;
  }>;
};

export default async function GatePage({ params, searchParams }: GatePageProps) {
  const { sessionId } = await params;
  const { error, lang, role, name } = await searchParams;

  const cookieStore = await cookies();
  const locale = isSupportedLocale(lang)
    ? lang
    : normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const t = dictionaries[locale];

  const validRole =
    role === "customer" || role === "employee" ? role : undefined;

  return (
    <main
      className="relative min-h-screen overflow-hidden gate-bg text-[var(--text-primary)]"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
    >
      {/* Bokeh — خلف الفورم، مركّزة فوقه وتحته فقط */}
      <div aria-hidden="true" className="gate-bokeh">
        <span /><span /><span /><span /><span /><span />
      </div>

      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10">
        <div className="flex-1 flex flex-col justify-center">
          <div
            className="tour-panel rounded-3xl p-8"
            style={{ boxShadow: "var(--shadow-xl)" }}
          >
            {/* Header */}
            <div className="text-center mb-8 flex flex-col items-center">
              <CompanyLogo className="h-14 w-40 object-contain text-[var(--brand-navy)] mb-4" />
              <p className="text-sm text-[var(--text-secondary)] mt-1">{t.gate.subtitle}</p>
            </div>

            <GateForm
              sessionId={sessionId}
              locale={locale}
              t={t.gate}
              initialRole={validRole}
              initialName={name}
              error={error}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
