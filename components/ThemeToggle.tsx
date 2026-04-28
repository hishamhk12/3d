"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTheme } from "@/components/ThemeProvider";

interface ThemeToggleProps {
  className?: string;
}

function subscribeToMountStore() {
  return () => {};
}

function getMountedSnapshot() {
  return true;
}

function getServerMountedSnapshot() {
  return false;
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToMountStore,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  const isDark = (mounted ? theme : "light") === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className={`
        group relative isolate inline-flex h-[50px] w-[150px] shrink-0 items-center justify-center
        overflow-visible rounded-full text-[13px] font-semibold
        transition-all duration-500 ease-out active:scale-[0.98]
        [-webkit-tap-highlight-color:transparent] [backface-visibility:hidden]
        ${className}
      `}
    >
      <span
        aria-hidden="true"
        className={`
          pointer-events-none absolute inset-0 z-0 rounded-full border border-[var(--border)]
          bg-[linear-gradient(135deg,var(--bg-panel-strong),var(--bg-panel))]
          backdrop-blur-md backdrop-saturate-150
          shadow-[var(--shadow-md),inset_0_1px_1px_rgba(255,255,255,0.22),inset_0_-14px_24px_rgba(0,60,113,0.08)]
          transition-all duration-500 ease-out
          before:pointer-events-none before:absolute before:inset-px before:rounded-full
          before:bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(255,255,255,0.04)_36%,transparent_70%)]
          after:pointer-events-none after:absolute after:inset-x-8 after:bottom-0 after:h-2 after:rounded-full after:bg-[var(--text-muted)]/20 after:blur-lg
          dark:bg-[linear-gradient(135deg,var(--bg-surface-2),var(--bg-surface))]
          dark:shadow-[var(--shadow-md),inset_0_1px_1px_rgba(255,255,255,0.12),inset_0_-14px_24px_rgba(0,0,0,0.28)]
        `}
      />

      <span
        aria-hidden="true"
        className={`
          pointer-events-none absolute left-[-8px] top-[-11px] z-20 flex h-[72px] w-[74px] items-center justify-center rounded-[30px]
          transition-all duration-500 ease-out
          [backface-visibility:hidden] [will-change:transform]
          ${
            isDark
              ? "translate-x-[92px] scale-100 group-active:scale-95"
              : "translate-x-0 scale-100 group-active:scale-95"
          }
        `}
      >
        <span className="absolute inset-0 rounded-[30px] border border-white/15 bg-white/[0.06] shadow-[0_12px_26px_rgba(0,0,0,0.22),inset_0_1px_1px_rgba(255,255,255,0.24)] backdrop-blur-2xl backdrop-saturate-200" />
        <span className="absolute inset-[3px] rounded-[27px] bg-gradient-to-br from-white/40 via-white/10 to-transparent opacity-40" />
        <span className="absolute left-4 top-3 h-5 w-8 rounded-[999px_999px_36px_36px] border-t border-l border-white/45 opacity-70 blur-[0.2px] [transform:rotate(-18deg)]" />
        <span className="absolute inset-2 rounded-[24px] bg-[radial-gradient(circle_at_62%_66%,rgba(255,255,255,0.12),transparent_48%)]" />
        <span
          className={`
            absolute h-11 w-[54px] rounded-full border border-white/10
            bg-[linear-gradient(135deg,rgba(28,46,69,0.92),rgba(12,26,43,0.82))]
            shadow-[inset_0_1px_1px_rgba(255,255,255,0.14),inset_0_-12px_20px_rgba(0,0,0,0.28),0_8px_18px_rgba(0,0,0,0.24)]
            transition-all duration-500 ease-out
            ${isDark ? "opacity-100" : "opacity-90"}
          `}
        />
        <Sun
          size={28}
          strokeWidth={2.35}
          className={`
            absolute text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.75)] [filter:drop-shadow(0_0_10px_rgba(255,255,255,0.75))_drop-shadow(0_0_18px_rgba(255,255,255,0.35))]
            transition-all duration-500 ease-out
            ${isDark ? "scale-75 opacity-0" : "scale-100 opacity-100"}
          `}
        />
        <Moon
          size={28}
          strokeWidth={2.35}
          className={`
            absolute text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.75)] [filter:drop-shadow(0_0_10px_rgba(255,255,255,0.75))_drop-shadow(0_0_18px_rgba(255,255,255,0.35))]
            transition-all duration-500 ease-out
            ${isDark ? "scale-100 opacity-100" : "scale-75 opacity-0"}
          `}
        />
      </span>

      <span
        className={`
          relative z-10 flex h-full w-12 items-center justify-center rounded-full text-[var(--text-secondary)]
          transition-all duration-500 ease-out
          ${isDark ? "translate-x-[-30px] opacity-100" : "translate-x-[30px] opacity-100"}
        `}
      >
        <span
          className={`
            absolute transition-all duration-500 ease-out
            ${isDark ? "scale-95 opacity-0" : "scale-100 opacity-100"}
          `}
        >
          Light
        </span>
        <span
          className={`
            absolute transition-all duration-500 ease-out
            ${isDark ? "scale-100 opacity-100" : "scale-95 opacity-0"}
          `}
        >
          Dark
        </span>
      </span>
    </button>
  );
}
