"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { logoutAction } from "../login/actions";
import { triggerCleanup, type CleanupResult } from "../actions";
import { AutoRefresh } from "./auto-refresh";

function CleanupButton() {
  const [result, formAction, isPending] = useActionState<CleanupResult | null, FormData>(
    triggerCleanup,
    null,
  );

  const total = result
    ? result.expired + result.idleExpired + result.stuckFailed + result.stuckRenderJobsFailed + result.completed
      + result.detectedIssues
    : 0;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-gray-500 hover:text-gray-200 transition-colors px-2.5 py-1.5 rounded-md hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-800"
      >
        {isPending ? "Running…" : "Run Cleanup"}
      </button>
      {result && (
        <span className="text-xs text-gray-600 whitespace-nowrap" title={`ran at ${result.ranAt}`}>
          {total === 0
            ? "nothing to clean"
            : [
                result.expired > 0 && `${result.expired} expired`,
                result.idleExpired > 0 && `${result.idleExpired} idle`,
                result.stuckFailed > 0 && `${result.stuckFailed} failed`,
                result.stuckRenderJobsFailed > 0 && `${result.stuckRenderJobsFailed} jobs failed`,
                result.completed > 0 && `${result.completed} completed`,
                result.detectedIssues > 0 && `${result.detectedIssues} issues`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      )}
    </form>
  );
}

export function AdminHeader() {
  const pathname = usePathname();

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
          active
            ? "bg-gray-800 text-white font-medium"
            : "text-gray-400 hover:text-white hover:bg-gray-800/60"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-gray-800 bg-gray-900 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand + nav */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white">Ibdaa 360</span>
          </div>

          <div className="h-4 w-px bg-gray-800" />

          <nav className="flex items-center gap-1">
            {navLink("/admin", "Dashboard")}
            {navLink("/admin/analytics", "Analytics")}
            {navLink("/admin/diagnostics", "Diagnostics")}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {pathname === "/admin" && (
            <>
              <CleanupButton />
              <div className="h-4 w-px bg-gray-800" />
              <AutoRefresh intervalSeconds={15} />
            </>
          )}

          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-gray-800"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
