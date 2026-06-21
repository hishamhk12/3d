"use client";

import * as React from "react";
import Link from "next/link";

/*
 * Shared Room Preview action button.
 *
 * Geometry & typography are taken VERBATIM from Figma file
 * AEPvicp28z7hc32EivzLEr — the two-button component (nodes 5239:2891/5239:2892):
 *   - height            48px
 *   - corner radius     100px (pill)
 *   - padding           16px horizontal · 13px vertical
 *   - gap (icon↔label)  10px
 *   - typography        17px / line-height 22px / weight 510 / letter-spacing -0.43px
 *   - width             full (w-full inside its container)
 *
 * Exactly two visual variants (no dark charcoal):
 *   - "blue"  → node 5239:2891 — background #0088FF, white label.
 *   - "light" → node 5239:2892 — background Fills/Secondary rgba(120,120,128,0.16)
 *               (Figma #78788029), label Labels/Primary #000000. No border/shadow/blur.
 *
 * The label is ALWAYS horizontally + vertically centered; an optional icon is
 * placed at the leading edge (logical start, so it follows RTL/LTR) using
 * absolute positioning so it never pushes the label off the geometric center.
 *
 * Renders a <button> by default, or a Next.js <Link> when `href` is provided.
 */

// ── Exact Figma values ───────────────────────────────────────────────────────
const BLUE_BG = "#0088FF"; // node 5239:2891 fill — do not alter
const BLUE_TEXT = "#ffffff"; // Labels/White
const LIGHT_BG = "rgba(120,120,128,0.16)"; // node 5239:2892 Fills/Secondary (#78788029)
const LIGHT_TEXT = "#000000"; // node 5239:2892 Labels/Primary

const VARIANT = {
  blue: {
    background: BLUE_BG,
    color: BLUE_TEXT,
    boxShadow: "0 10px 26px rgba(0,136,255,0.30)",
    ring: "focus-visible:ring-[#0088FF]/60",
  },
  light: {
    background: LIGHT_BG,
    color: LIGHT_TEXT,
    boxShadow: "none",
    ring: "focus-visible:ring-black/25",
  },
} as const;

type MobileActionButtonVariant = keyof typeof VARIANT;

const BASE_CLASS =
  // Exact Figma geometry + centered content
  "relative inline-flex h-[48px] w-full items-center justify-center gap-[10px] " +
  "overflow-hidden rounded-[100px] px-[16px] py-[13px] text-center " +
  // Exact Figma typography
  "text-[17px] font-[510] leading-[22px] tracking-[-0.43px] " +
  // Approved interaction states (pressed / hover-focus / disabled)
  "transition-all duration-200 active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "disabled:opacity-40 disabled:cursor-not-allowed aria-disabled:opacity-40";

interface SharedProps {
  /** "blue" = #0088FF / white · "light" = rgba(120,120,128,0.16) / black (node 5239:2892). */
  variant?: MobileActionButtonVariant;
  /** Shows a spinner in the leading slot and disables the control. */
  loading?: boolean;
  /** Optional leading icon (kept at the leading edge; never offsets the centered label). */
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

type ButtonElementProps = SharedProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & { href?: undefined };
type LinkElementProps = SharedProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedProps> & { href: string };

export type MobileActionButtonProps = ButtonElementProps | LinkElementProps;

/** Leading icon/spinner slot + centered label — identical for both elements. */
function ButtonContent({
  loading,
  icon,
  children,
}: {
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      {loading || icon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-[16px] flex items-center justify-center"
        >
          {loading ? (
            <span className="inline-block h-[18px] w-[18px] animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            icon
          )}
        </span>
      ) : null}
      <span className="inline-flex items-center justify-center">{children}</span>
    </>
  );
}

export function MobileActionButton(props: MobileActionButtonProps) {
  const { variant = "light", loading = false, icon, className = "", children, style, ...rest } = props;
  const v = VARIANT[variant];
  const mergedClassName = `${BASE_CLASS} ${v.ring} ${className}`;
  const mergedStyle: React.CSSProperties = {
    background: v.background,
    color: v.color,
    boxShadow: v.boxShadow,
    ...style,
  };

  if (rest.href !== undefined) {
    const { href, ...anchorRest } = rest as Omit<LinkElementProps, keyof SharedProps>;
    return (
      <Link
        href={href}
        className={mergedClassName}
        style={mergedStyle}
        aria-busy={loading || undefined}
        {...anchorRest}
      >
        <ButtonContent loading={loading} icon={icon}>
          {children}
        </ButtonContent>
      </Link>
    );
  }

  const { type = "button", disabled, ...buttonRest } = rest as Omit<ButtonElementProps, keyof SharedProps>;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={mergedClassName}
      style={mergedStyle}
      {...buttonRest}
    >
      <ButtonContent loading={loading} icon={icon}>
        {children}
      </ButtonContent>
    </button>
  );
}
