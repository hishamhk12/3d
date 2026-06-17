"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import {
  Badge,
  Button,
  Text,
} from "@fluentui/react-components";
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
      <Button appearance="secondary" disabled={isPending} size="small" type="submit">
        {isPending ? "Running..." : "Run cleanup"}
      </Button>
      {result ? (
        <Badge appearance="tint" color={total === 0 ? "subtle" : "important"}>
          {total === 0 ? "nothing to clean" : `${total} updates`}
        </Badge>
      ) : null}
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
        className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
          active
            ? "bg-[#e8f0fe] text-[#115ea3] font-semibold"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-5">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-[#115ea3] text-white">
              <span className="text-xs font-bold">I</span>
            </div>
            <Text size={300} weight="semibold">Ibdaa 360</Text>
          </div>

          <div className="h-4 w-px bg-slate-200" />

          <nav className="flex items-center gap-1">
            {navLink("/admin", "Dashboard")}
            {navLink("/admin/analytics", "Analytics")}
            {navLink("/admin/diagnostics", "Diagnostics")}
            {navLink("/admin/render-errors", "Render Errors")}
            {navLink("/admin/chatbot", "Chatbot")}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {pathname === "/admin" ? (
            <>
              <CleanupButton />
              <div className="h-4 w-px bg-slate-200" />
              <AutoRefresh intervalSeconds={15} />
            </>
          ) : null}

          <form action={logoutAction}>
            <Button appearance="subtle" size="small" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
