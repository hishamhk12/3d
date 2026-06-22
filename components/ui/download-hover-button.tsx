"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Download } from "lucide-react";

// Installed from https://21st.dev/r/hardik0110/download-hover-button and adapted:
// the hover-expand animation (compact 64px circle → 220px pill, icon visible
// while collapsed, label fading in while expanded, 0.3s width / 0.2s opacity)
// is preserved as the interaction source of truth. Only the demo's red
// background / absolute positioning / "↓" glyph / placeholder link are swapped
// for the existing Room Preview glass action-button tokens, a lucide Download
// icon, and the real generated-image download.

export interface DownloadHoverButtonProps {
  /** Real generated-image URL to download. */
  href: string;
  /** Suggested download filename. */
  downloadName?: string;
  /** Localized label shown while expanded (e.g. "تحميل"). */
  label: string;
  /** Optional handler if the download is function-driven rather than a plain anchor. */
  onClick?: () => void | Promise<void>;
  className?: string;
  ariaLabel?: string;
}

const COLLAPSED = 64;
const EXPANDED = 220;

// Shared glass tokens — identical to the previous Room Preview Download button.
const GLASS =
  "border border-white/12 bg-white/[0.08] backdrop-blur-md transition-colors hover:bg-white/[0.14] focus-visible:bg-white/[0.14] active:bg-white/[0.14]";

export default function DownloadHoverButton({
  href,
  downloadName,
  label,
  onClick,
  className = "",
  ariaLabel,
}: DownloadHoverButtonProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const prefersReducedMotion = useReducedMotion();

  const handleClick = React.useCallback(() => {
    if (onClick) void onClick();
  }, [onClick]);

  // Reduced motion: static, fully-visible pill (icon + label, no width animation).
  if (prefersReducedMotion) {
    return (
      <a
        href={href}
        download={downloadName}
        onClick={handleClick}
        aria-label={ariaLabel ?? label}
        className={`mx-auto flex h-16 items-center justify-center gap-2 rounded-[32px] px-6 ${GLASS} ${className}`}
      >
        <Download className="size-5 text-[#00AFD7]" aria-hidden />
        <span className="whitespace-nowrap text-lg font-bold text-white/85">{label}</span>
      </a>
    );
  }

  return (
    <a
      href={href}
      download={downloadName}
      onClick={handleClick}
      aria-label={ariaLabel ?? label}
      className={`mx-auto block w-max outline-none ${className}`}
    >
      <motion.div
        initial={{ width: COLLAPSED, height: COLLAPSED }}
        animate={{ width: isExpanded ? EXPANDED : COLLAPSED, height: COLLAPSED }}
        // onHoverStart/End fire for mouse only → no stuck-expanded state on touch.
        whileHover={{ width: EXPANDED }}
        // Brief press feedback on touch; download still fires immediately via the <a>.
        whileTap={{ width: EXPANDED }}
        onHoverStart={() => setIsExpanded(true)}
        onHoverEnd={() => setIsExpanded(false)}
        transition={{ duration: 0.3 }}
        className={`relative flex items-center justify-center overflow-hidden ${GLASS}`}
        style={{ borderRadius: 32 }}
      >
        {/* Icon — centered while collapsed, fades out as the label appears. */}
        <motion.span
          className="absolute flex items-center justify-center"
          animate={{ opacity: isExpanded ? 0 : 1, scale: isExpanded ? 0.8 : 1 }}
          transition={{ duration: 0.2 }}
        >
          <Download className="size-6 text-[#00AFD7]" aria-hidden />
        </motion.span>

        {/* Label — fades in while expanded. */}
        <motion.span
          className="flex w-full items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: isExpanded ? 1 : 0 }}
          transition={{ duration: 0.2, delay: isExpanded ? 0.1 : 0 }}
        >
          <span className="whitespace-nowrap text-lg font-bold text-white/85">{label}</span>
        </motion.span>
      </motion.div>
    </a>
  );
}
