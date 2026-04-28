"use client";

import React, { ButtonHTMLAttributes, MouseEvent, useState } from "react";
import { useAnimatedNavigation } from "@/hooks/useAnimatedNavigation";

export interface AnimatedButtonProps {
  children?: React.ReactNode;
  href?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  glowColor?: string;
  animationDelay?: number;
  disabled?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  form?: string;
  "aria-label"?: string;
}

export function AnimatedButton({
  children,
  href,
  onClick,
  className = "",
  glowColor = "rgba(255, 255, 255, 0.4)",
  animationDelay = 400,
  disabled,
  type,
  form,
  "aria-label": ariaLabel,
}: AnimatedButtonProps) {
  const { navigate } = useAnimatedNavigation(animationDelay);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();

    setRipples((prev) => [...prev, { id, x, y }]);

    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);

    if (onClick) {
      onClick(e);
    }

    if (href && !e.defaultPrevented) {
      navigate(href);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`relative overflow-hidden transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg active:translate-y-0 active:scale-95 ${className}`}
      style={{ touchAction: "manipulation" }}
      disabled={disabled}
      type={type}
      form={form}
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
    </button>
  );
}
