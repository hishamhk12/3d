"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

export const IS_DEV = process.env.NODE_ENV === "development";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = "info" | "success" | "warn" | "error" | "network" | "state";

export type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  /** Optional second line — error details, response body snippet, etc. */
  detail?: string;
  /** Milliseconds since the hook was first called (component mount). */
  ts: number;
};

// ─── useDebugLog ──────────────────────────────────────────────────────────────

/**
 * Lightweight structured log accumulator.
 *
 * In development: maintains a log array and exposes `add` / `clear`.
 * In production:  `add` is a stable no-op — zero runtime cost.
 */
export function useDebugLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const counterRef = useRef(0);
  // eslint-disable-next-line react-hooks/purity
  const startRef = useRef(Date.now());

  const add = useCallback(
    (level: LogLevel, message: string, detail?: string) => {
      if (!IS_DEV) return;
      setEntries((prev) => [
        ...prev,
        { id: counterRef.current++, level, message, detail, ts: Date.now() - startRef.current },
      ]);
    },
    [],
  );

  const clear = useCallback(() => setEntries([]), []);

  return { entries, add, clear };
}

// ─── DevDebugOverlay ──────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<LogLevel, string> = {
  info:    "#6ee7b7",
  success: "#4ade80",
  warn:    "#fbbf24",
  error:   "#f87171",
  network: "#60a5fa",
  state:   "#c084fc",
};

const LEVEL_ICON: Record<LogLevel, string> = {
  info:    "ℹ",
  success: "✓",
  warn:    "⚠",
  error:   "✖",
  network: "⇆",
  state:   "◈",
};

function overlayBtnStyle(bg: string, color = "#fff"): React.CSSProperties {
  return {
    background: bg,
    color,
    border: "none",
    borderRadius: 4,
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    lineHeight: "1.4",
  };
}

/**
 * Development-only fixed overlay at the bottom of the screen.
 *
 * Shows every log entry from `useDebugLog` in real time.
 * Highlights `TypeError: Failed to fetch` in bright red — that error always
 * means the phone cannot reach the server (firewall / wrong IP / wrong network).
 *
 * Rendered with `position: fixed` so it floats above all page content.
 * Removed entirely from production builds by the IS_DEV guard at the call site.
 */
export function DevDebugOverlay({
  entries,
  onClear,
}: {
  entries: LogEntry[];
  onClear: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const bodyRef   = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);

  useEffect(() => {
    if (!minimized && entries.length > prevCount.current) {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
    }
    prevCount.current = entries.length;
  }, [entries, minimized]);

  const hasFirewallError = entries.some(
    (e) => e.level === "error" && e.message.toLowerCase().includes("failed to fetch"),
  );

  return (
    <div
      style={{
        position:      "fixed",
        bottom:        0,
        left:          0,
        right:         0,
        zIndex:        99999,
        fontFamily:    "ui-monospace, 'Cascadia Code', monospace",
        fontSize:      11,
        background:    "rgba(5, 5, 10, 0.94)",
        borderTop:     "2px solid #1f2937",
        display:       "flex",
        flexDirection: "column",
        maxHeight:     minimized ? 34 : 280,
        transition:    "max-height 0.2s ease",
        // Prevent the overlay from being covered by iOS Safari's bottom bar.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          6,
          padding:      "4px 10px",
          background:   "#0f172a",
          flexShrink:   0,
          borderBottom: minimized ? "none" : "1px solid #1f2937",
        }}
      >
        <span style={{ color: "#fbbf24", fontWeight: 700, flex: 1, letterSpacing: "0.05em" }}>
          🔍 DEBUG [{entries.length}]
          {hasFirewallError && (
            <span style={{ color: "#f87171", marginLeft: 8 }}>⚠ NETWORK ERROR</span>
          )}
        </span>
        <button onClick={onClear}                       style={overlayBtnStyle("#374151", "#d1d5db")}>Clear</button>
        <button onClick={() => setMinimized((m) => !m)} style={overlayBtnStyle("#1d4ed8", "#bfdbfe")}>
          {minimized ? "▲" : "▼"}
        </button>
      </div>

      {/* ── Firewall hint banner ─────────────────────────────────────────────── */}
      {!minimized && hasFirewallError && (
        <div
          style={{
            background:   "#450a0a",
            borderBottom: "1px solid #7f1d1d",
            padding:      "5px 10px",
            color:        "#fca5a5",
            fontSize:     10,
            lineHeight:   "1.5",
            flexShrink:   0,
          }}
        >
          <strong>TypeError: Failed to fetch</strong> — the phone cannot reach the server.
          Likely causes: <strong>(1)</strong> phone not on same WiFi as laptop
          · <strong>(2)</strong> Windows Firewall blocking port 3000
          · <strong>(3)</strong> wrong IP in QR code
        </div>
      )}

      {/* ── Log body ────────────────────────────────────────────────────────── */}
      {!minimized && (
        <div
          ref={bodyRef}
          style={{ overflowY: "auto", flex: 1, padding: "6px 10px 10px" }}
        >
          {entries.length === 0 ? (
            <div style={{ color: "#4b5563", fontStyle: "italic" }}>No entries yet…</div>
          ) : (
            entries.map((entry) => {
              const isFirewall =
                entry.level === "error" &&
                entry.message.toLowerCase().includes("failed to fetch");

              return (
                <div
                  key={entry.id}
                  style={{
                    marginBottom: 3,
                    background:   isFirewall ? "rgba(127,29,29,0.25)" : "transparent",
                    borderRadius: 4,
                    padding:      isFirewall ? "2px 4px" : 0,
                  }}
                >
                  <span style={{ color: "#4b5563" }}>{entry.ts}ms </span>
                  <span style={{ color: LEVEL_COLOR[entry.level], fontWeight: 700, marginRight: 4 }}>
                    {LEVEL_ICON[entry.level]}
                  </span>
                  <span style={{ color: isFirewall ? "#fca5a5" : "#e5e7eb" }}>
                    {entry.message}
                  </span>
                  {entry.detail && (
                    <div
                      style={{
                        marginLeft: 12,
                        marginTop:  1,
                        color:      entry.level === "error" ? "#fca5a5" : "#6b7280",
                        fontSize:   10,
                        wordBreak:  "break-all",
                        lineHeight: "1.4",
                      }}
                    >
                      {entry.detail}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
