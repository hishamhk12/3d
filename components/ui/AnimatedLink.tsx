"use client";

import React, { MouseEvent, useState } from "react";
import { useAnimatedNavigation } from "@/hooks/useAnimatedNavigation";

export interface AnimatedLinkProps {
  children?: React.ReactNode;
  href: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  glowColor?: string;
  animationDelay?: number;
  target?: string;
  rel?: string;
  "aria-label"?: string;
}

export function AnimatedLink({
  children,
  href,
  onClick,
  className = "",
  glowColor = "rgba(255, 255, 255, 0.4)",
  animationDelay = 400,
  target,
  rel,
  "aria-label": ariaLabel,
}: AnimatedLinkProps) {
  const { navigate } = useAnimatedNavigation(animationDelay);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.button !== 0) return;

    if (onClick) {
      onClick(e);
    }

    if (e.defaultPrevented) return;

    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();

    setRipples((prev) => [...prev, { id, x, y }]);

    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);

    navigate(href);
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`relative inline-block overflow-hidden transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg active:translate-y-0 active:scale-95 ${className}`}
      style={{ touchAction: "manipulation" }}
      target={target}
      rel={rel}
      aria-label={ariaLabel}
    >
      <span className="relative z-10 flex h-full w-full items-center justify-center gap-2">
        {children}
      </span>

      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="animated-ripple pointer-events-none absolute z-0 rounded-full"
          style={{
            top: ripple.y,
            left: ripple.x,
            width: "100px",
            height: "100px",
            marginTop: "-50px",
            marginLeft: "-50px",
            background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
          }}
        />
      ))}
    </a>
  );
}
