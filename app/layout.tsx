import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, Tajawal } from "next/font/google";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import { LOCALE_COOKIE_NAME, normalizeLocale, getLocaleDirection } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic"],
  weight: ["200", "300", "400", "500", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Panorama Studio",
  description:
    "A bilingual interface for panorama tours and the room preview workflow.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(LOCALE_COOKIE_NAME);
  const locale = normalizeLocale(localeCookie?.value);
  const dir = getLocaleDirection(locale);

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${tajawal.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--bg-page)] text-[var(--text-primary)]">
        <ThemeProvider>
          <I18nProvider initialLocale={locale} initialLocaleCookiePresent={Boolean(localeCookie)}>
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
