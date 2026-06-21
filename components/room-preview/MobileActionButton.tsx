"use client";

import * as React from "react";

/*
 * Shared mobile Room Preview action button.
 *
 * Geometry & typography are taken VERBATIM from the Figma node
 * AEPvicp28z7hc32EivzLEr / 5239:2890 ("Buttons"):
 *   - height            48px
 *   - corner radius     100px (pill)
 *   - padding           16px horizontal · 13px vertical
 *   - gap (icon↔label)  10px
 *   - typography        17px / line-height 22px / weight 510 / letter-spacing -0.43px
 *   - width             full (w-full inside its container)
 *
 * Two colour variants (per task):
 *   - "primary" → the project's existing main brand action colour (#192126)
 *   - "blue"    → the exact Figma secondary blue (#0088FF)
 *
 * The label is ALWAYS horizontally + vertically centered; an optional icon is
 * placed at the leading edge (logical start, so it follows RTL/LTR) using
 * absolute positioning so it never pushes the label off the visual center.
 */

const PRIMARY_BG = "#192126"; // existing project primary brand action colour
const BLUE_BG = "#0088FF"; // exact Figma secondary blue — do not alter

const VARIANT: Record<
  "primary" | "blue",
  { background: string; boxShadow: string; ring: string }
> = {
  primary: {
    background: PRIMARY_BG,
    boxShadow: "0 10px 26px rgba(25,33,38,0.28)",
    ring: "focus-visible:ring-[#192126]/45",
  },
  blue: {
    background: BLUE_BG,
    boxShadow: "0 10px 26px rgba(0,136,255,0.30)",
    ring: "focus-visible:ring-[#0088FF]/60",
  },
};

export interface MobileActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** "primary" = #192126 (project brand), "blue" = #0088FF (Figma secondary). */
  variant?: "primary" | "blue";
  /** Shows a spinner in the leading slot and disables the button. */
  loading?: boolean;
  /** Optional leading icon (kept at the leading edge; never offsets the centered label). */
  icon?: React.ReactNode;
}

export const MobileActionButton = React.forwardRef<
  HTMLButtonElement,
  MobileActionButtonProps
>(function MobileActionButton(
  { variant = "primary", loading = false, icon, disabled, className = "", children, style, type = "button", ...rest },
  ref,
) {
  const v = VARIANT[variant];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={
        // Exact Figma geometry + centered content
        "relative inline-flex h-[48px] w-full items-center justify-center gap-[10px] " +
        "overflow-hidden rounded-[100px] px-[16px] py-[13px] text-center " +
        // Exact Figma typography
        "text-[17px] font-[510] leading-[22px] tracking-[-0.43px] text-white " +
        // Approved interaction states (pressed / hover-focus / disabled)
        "transition-all duration-200 active:scale-[0.98] " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
        "disabled:opacity-40 disabled:cursor-not-allowed " +
        `${v.ring} ${className}`
      }
      style={{ background: v.background, boxShadow: v.boxShadow, ...style }}
      {...rest}
    >
      {/* Leading slot — spinner while loading, otherwise the optional icon.
          Absolutely positioned so the label stays at the true visual center. */}
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
    </button>
  );
});
