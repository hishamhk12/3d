import LanguageSwitcher from "@/components/LanguageSwitcher";
import { GateForm } from "./_components/gate-form";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { CompanyLogo } from "@/components/CompanyLogo";

type GatePageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{
    error?: string;
    role?: string;
    name?: string;
  }>;
};

export default async function GatePage({ params, searchParams }: GatePageProps) {
  const { sessionId } = await params;
  const { error, role, name } = await searchParams;

  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const t = dictionaries[locale];

  const validRole =
    role === "customer" || role === "employee" ? role : undefined;

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#e8f3fc] text-[#0a1f3d]"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
    >
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10">
          {/* Language switcher */}
          <div className="flex w-full justify-end mb-8">
            <LanguageSwitcher />
          </div>

          {/* Card */}
          <div className="flex-1 flex flex-col justify-center">
            <div className="bg-white/70 backdrop-blur-sm rounded-3xl border border-[#0a1f3d]/10 p-8 shadow-sm">
              {/* Header */}
              <div className="text-center mb-8 flex flex-col items-center">
                <CompanyLogo className="h-14 w-40 object-contain text-[#0a1f3d] mb-4" />
                <p className="text-sm text-[#0a1f3d]/60 mt-1">{t.gate.subtitle}</p>
              </div>

              {/* Dynamic form */}
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
