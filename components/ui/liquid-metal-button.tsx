"use client";

import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

interface LiquidMetalButtonProps {
  label?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  viewMode?: "text" | "icon";
  /** Outer dimensions — defaults match the original 142×46 component. */
  height?: number;
  /** Horizontal padding that drives the (content-based) width. */
  paddingX?: number;
  /** Pill radius — original is 100. */
  radius?: number;
  /** Outer wrapper style (position / z-index / flex placement). */
  style?: React.CSSProperties;
  ariaLabel?: string;
}

// Shared transition string — copied verbatim from the original component.
const TRANSITION =
  "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease";

// Frosted-glass inner surface — reuses the project's existing card glass
// language (SessionStage tile glass) instead of the original black gradient.
// Translucent, backdrop-blurred, softly bordered, subtly highlighted; the
// liquid-metal shader stays visible as the outer rim + frosted sheen.
const GLASS_INNER: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(67.955px)",
  WebkitBackdropFilter: "blur(67.955px)",
  border: "1px solid rgba(255,255,255,0.30)",
};
const GLASS_HIGHLIGHT =
  "inset -1px 0px 4px 0px rgba(255,255,255,0.25), inset 2px 1px 4px 0px rgba(255,255,255,0.25)";

export function LiquidMetalButton({
  label = "Get Started",
  children,
  onClick,
  viewMode = "text",
  height = 46,
  paddingX = 22,
  radius = 100,
  style,
  ariaLabel,
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<
    Array<{ x: number; y: number; id: number }>
  >([]);
  const shaderRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: External library without types
  const shaderMount = useRef<any>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rippleId = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const styleId = "shader-canvas-style-exploded";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: 100px !important;
        }
        @keyframes ripple-animation {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const loadShader = async () => {
      try {
        if (shaderRef.current) {
          if (shaderMount.current?.destroy) {
            shaderMount.current.destroy();
          }

          // Reduced motion → freeze the shader at speed 0 (still visible).
          const initialSpeed = reducedMotionRef.current ? 0 : 0.6;

          shaderMount.current = new ShaderMount(
            shaderRef.current,
            liquidMetalFragmentShader,
            {
              u_repetition: 4,
              u_softness: 0.5,
              u_shiftRed: 0.3,
              u_shiftBlue: 0.3,
              u_distortion: 0,
              u_contour: 0,
              u_angle: 45,
              u_scale: 8,
              u_shape: 1,
              u_offsetX: 0.1,
              u_offsetY: -0.1,
            },
            undefined,
            initialSpeed,
          );
        }
      } catch (error) {
        // Shader failed → the glass + text + clickable button remain visible.
        console.error("[liquid-metal-button] Failed to load shader:", error);
      }
    };

    loadShader();

    return () => {
      if (shaderMount.current?.destroy) {
        shaderMount.current.destroy();
        shaderMount.current = null;
      }
    };
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (!reducedMotionRef.current) shaderMount.current?.setSpeed?.(1);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    if (!reducedMotionRef.current) shaderMount.current?.setSpeed?.(0.6);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!reducedMotionRef.current && shaderMount.current?.setSpeed) {
      shaderMount.current.setSpeed(2.4);
      setTimeout(() => {
        if (isHovered) {
          shaderMount.current?.setSpeed?.(1);
        } else {
          shaderMount.current?.setSpeed?.(0.6);
        }
      }, 300);
    }

    if (!reducedMotionRef.current && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ripple = { x, y, id: rippleId.current++ };

      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
      }, 600);
    }

    onClick?.();
  };

  return (
    <div className="relative inline-block" style={style}>
      <div
        style={{
          perspective: "1000px",
          perspectiveOrigin: "50% 50%",
        }}
      >
        {/* 3D layer container — content-sized (height fixed, width = content + paddingX). */}
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: `${height}px`,
            padding: `0 ${paddingX}px`,
            borderRadius: `${radius}px`,
            transformStyle: "preserve-3d",
            transition: TRANSITION,
            transform: "none",
          }}
        >
          {/* Inner surface — frosted glass (replaces the original black fill). */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transition: TRANSITION,
              transform: `translateZ(10px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
              zIndex: 20,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "2px",
                borderRadius: `${radius}px`,
                ...GLASS_INNER,
                boxShadow: isPressed
                  ? "inset 0px 2px 4px rgba(0, 0, 0, 0.25), inset 0px 1px 2px rgba(0, 0, 0, 0.18)"
                  : GLASS_HIGHLIGHT,
                transition:
                  "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>

          {/* Shader layer — liquid metal (original values, original shadows). */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transition: TRANSITION,
              transform: `translateZ(0px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
              zIndex: 10,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: `${radius}px`,
                boxShadow: isPressed
                  ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
                  : isHovered
                    ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
                    : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
                transition:
                  "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                background: "rgb(0 0 0 / 0)",
              }}
            >
              <div
                ref={shaderRef}
                className="shader-container-exploded"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: `${radius}px`,
                  overflow: "hidden",
                  transition: "width 0.4s ease, height 0.4s ease",
                }}
              />
            </div>
          </div>

          {/* Clickable layer — transparent, handles hover/press/ripple. */}
          <button
            ref={buttonRef}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={() => setIsPressed(true)}
            onMouseUp={() => setIsPressed(false)}
            style={{
              position: "absolute",
              inset: 0,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              outline: "none",
              zIndex: 40,
              transformStyle: "preserve-3d",
              transform: "translateZ(25px)",
              transition: TRANSITION,
              overflow: "hidden",
              borderRadius: `${radius}px`,
            }}
            aria-label={ariaLabel ?? label}
          >
            {ripples.map((ripple) => (
              <span
                key={ripple.id}
                style={{
                  position: "absolute",
                  left: `${ripple.x}px`,
                  top: `${ripple.y}px`,
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 70%)",
                  pointerEvents: "none",
                  animation: "ripple-animation 0.6s ease-out",
                }}
              />
            ))}
          </button>

          {/* Text layer — in-flow (drives width), floats above on translateZ(20). */}
          <div
            style={{
              position: "relative",
              zIndex: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              transformStyle: "preserve-3d",
              transition: TRANSITION,
              transform: "translateZ(20px)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {children ??
              (viewMode === "icon" ? (
                <Sparkles
                  size={16}
                  style={{
                    color: "#666666",
                    filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.5))",
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: "14px",
                    color: "#666666",
                    fontWeight: 400,
                    textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
