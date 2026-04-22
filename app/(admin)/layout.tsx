import type { ReactNode } from "react";

/**
 * Admin section layout.
 *
 * Intentionally minimal — no i18n, no customer-facing fonts or branding.
 * This layout is nested inside the root app/layout.tsx which provides
 * the <html> / <body> shell and global CSS.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100" dir="ltr">
      {children}
    </div>
  );
}
