"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

type RoomPreviewBackButtonProps = {
  ariaLabel: string;
  className?: string;
  href?: string;
  onClick?: () => void;
  size: number;
  style?: CSSProperties;
};

/**
 * Exact Room Preview back control extracted from the TV session stage.
 * The 36×36 SVG and the whole control scale uniformly through `size`.
 */
export default function RoomPreviewBackButton({
  ariaLabel,
  className = "",
  href,
  onClick,
  size,
  style,
}: RoomPreviewBackButtonProps) {
  const classes = `absolute z-[3] flex items-center justify-center rounded-[40px] bg-white/30 transition-all duration-200 hover:bg-white/40 active:scale-95 ${className}`;
  const buttonStyle: CSSProperties = {
    width: size,
    height: size,
    backdropFilter: "blur(30px) saturate(140%)",
    WebkitBackdropFilter: "blur(30px) saturate(140%)",
    ...style,
  };
  const icon = (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="block size-full" aria-hidden="true">
      <path opacity="0" d="M36 0H0V36H36V0Z" fill="white" />
      <path
        d="M20.8852 26.7447C20.6799 26.9397 20.4104 27.032 20.0767 27.0217C19.7431 27.0115 19.4685 26.9038 19.2529 26.6986L12.8312 20.6495C12.5438 20.3827 12.3513 20.0645 12.2538 19.6951C12.1562 19.3257 12.1562 18.9563 12.2538 18.5869C12.3513 18.2175 12.5438 17.8994 12.8312 17.6326L19.2529 11.5989C19.489 11.3731 19.7636 11.2551 20.0767 11.2448C20.3899 11.2346 20.6543 11.3372 20.8699 11.5527C21.106 11.7682 21.2291 12.0401 21.2393 12.3685C21.2496 12.6968 21.1367 12.9739 20.9006 13.1996L14.5714 19.141L20.9006 25.0977C21.1264 25.3132 21.2393 25.5851 21.2393 25.9135C21.2393 26.2418 21.1213 26.5189 20.8852 26.7447Z"
        fill="white"
      />
    </svg>
  );

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={classes} style={buttonStyle}>
        {icon}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={classes} style={buttonStyle}>
      {icon}
    </button>
  );
}
