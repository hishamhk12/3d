"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";

type SessionStatePanelAction = {
  href?: string;
  label: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
};

type SessionStatePanelProps = {
  actions?: SessionStatePanelAction[];
  description: string;
  eyebrow?: string;
  title: string;
};

export default function SessionStatePanel({
  actions,
  description,
  eyebrow,
  title,
}: SessionStatePanelProps) {
  const { t } = useI18n();
  const resolvedEyebrow = eyebrow ?? t.roomPreview.shared.eyebrow;

  return (
    <div className="tour-panel w-full rounded-[32px] p-8 text-center">
      <p className="text-xs font-semibold tracking-[0.22em] text-[#8B6914] uppercase" style={{textShadow:'0 1px 2px rgba(255,255,255,0.8)'}}>{resolvedEyebrow}</p>
      <h1 className="font-display mt-4 text-4xl font-semibold text-[#0a1f3d]">{title}</h1>
      <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#3a5472]">{description}</p>

      {actions?.length ? (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action) =>
            action.href ? (
              <Link
                key={`${action.label}-${action.href}`}
                href={action.href}
                className={`inline-flex rounded-full px-5 py-3 text-sm font-semibold ${
                  action.variant === "secondary"
                    ? "border border-[rgba(0,60,113,0.20)] bg-white/70 text-[#3a5472] hover:border-[rgba(201,162,74,0.40)] hover:text-[#0a1f3d]"
                    : "tour-button"
                }`}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={`inline-flex rounded-full px-5 py-3 text-sm font-semibold ${
                  action.variant === "secondary"
                    ? "border border-[rgba(0,60,113,0.20)] bg-white/70 text-[#3a5472] hover:border-[rgba(201,162,74,0.40)] hover:text-[#0a1f3d]"
                    : "tour-button"
                }`}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
