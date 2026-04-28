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
    <div className="tour-panel w-full rounded-3xl p-8 md:p-12 text-center animate-in fade-in duration-700">
      <p className="text-xs font-semibold tracking-[0.22em] text-[var(--brand-cyan)] uppercase">{resolvedEyebrow}</p>
      <h1 className="font-display mt-4 text-3xl md:text-4xl font-bold text-[var(--text-primary)] tracking-tight">{title}</h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-[var(--text-secondary)]">{description}</p>

      {actions?.length ? (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {actions.map((action) =>
            action.href ? (
              <Link
                key={`${action.label}-${action.href}`}
                href={action.href}
                className={action.variant === "secondary" ? "btn-secondary px-6 py-3 text-sm" : "btn-primary px-6 py-3 text-sm"}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={action.variant === "secondary" ? "btn-secondary px-6 py-3 text-sm" : "btn-primary px-6 py-3 text-sm"}
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
