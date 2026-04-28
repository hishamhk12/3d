"use client";

import { useCallback, useEffect, useRef } from "react";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Re-mount within this window → MOBILE_RAPID_RELOAD issue (req 4) */
const RAPID_RELOAD_WINDOW_MS = 10_000;

/** N fetches within the window → MOBILE_EXCESSIVE_POLLING issue (req 5) */
const EXCESSIVE_FETCH_THRESHOLD = 6;
const EXCESSIVE_FETCH_WINDOW_MS = 10_000;

function mountStorageKey(id: string) {
  return `rp:mount-ts:${id}`;
}

/**
 * Passive diagnostics hook for the mobile session page.
 *
 * Covers requirements:
 *   1. Mount / unmount events with sessionId
 *   2. Router navigate detection via History API patching
 *   3. Timestamp on every session fetch (via trackFetch())
 *   4. Rapid-reload detection using sessionStorage timestamps
 *   5. Excessive polling detection with sliding-window counter
 *   6. window.error + unhandledrejection tracking
 *   7. visibilitychange / pagehide / pageshow for iOS lifecycle
 *
 * Never throws — all diagnostics are fire-and-forget.
 * Never modifies session state or user-visible behaviour.
 */
export function useMobileDiagnostics(sessionId: string) {
  // Current session status available inside event listeners without
  // re-registering effects on every status change.
  const statusRef = useRef<string | null>(null);

  // Sliding-window ring buffer for excessive-polling detection.
  const fetchTs = useRef<number[]>([]);
  const excessiveFlagSent = useRef(false);

  // 1 + 4: Mount/unmount + rapid-reload detection
  useEffect(() => {
    const now = Date.now();

    let navigationType = "navigate";
    try {
      const entry = performance.getEntriesByType?.("navigation")?.[0] as
        | PerformanceNavigationTiming
        | undefined;
      navigationType = entry?.type ?? "navigate";
    } catch {
      /* not available in all mobile browsers */
    }

    // Rapid-reload detection (req 4): sessionStorage persists across full-page
    // reloads within the same tab. We compare the previous mount timestamp.
    try {
      const key = mountStorageKey(sessionId);
      const prevStr = sessionStorage.getItem(key);
      if (prevStr) {
        const prev = parseInt(prevStr, 10);
        if (Number.isFinite(prev) && now - prev < RAPID_RELOAD_WINDOW_MS) {
          trackClientSessionEvent(sessionId, {
            source: "mobile",
            eventType: "mobile_rapid_reload_detected",
            level: "error",
            // code = issue type so the diagnostics API auto-opens MOBILE_RAPID_RELOAD
            code: "MOBILE_RAPID_RELOAD",
            metadata: {
              intervalMs: now - prev,
              navigationType,
              status: statusRef.current,
            },
          });
        }
      }
      sessionStorage.setItem(key, String(now));
    } catch {
      /* sessionStorage unavailable — private browsing, storage quota, or WebView sandbox */
    }

    // Mount event (req 1)
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_page_mounted",
      level: "info",
      metadata: {
        navigationType,
        url: window.location.href,
        userAgent: navigator.userAgent,
        ts: now,
      },
    });

    // Unmount event (req 1)
    return () => {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_page_unmounted",
        level: "warning",
        metadata: { status: statusRef.current },
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2: History API patching — detects Next.js router.push / replace / refresh.
  // router.refresh() triggers a soft navigation that Next.js implements via
  // replaceState; router.push/replace use pushState / replaceState respectively.
  //
  // replaceState is called by Next.js on *every* prefetch, URL param update,
  // and router state sync — it can fire dozens of times per second during
  // rendering.  We keep a ref-based timestamp so only the first replaceState
  // per 5 seconds makes it to the server; pushState (real navigation) is kept
  // unthrottled because it's rare and carries unique routing information.
  useEffect(() => {
    const origPush    = window.history.pushState.bind(window.history);
    const origReplace = window.history.replaceState.bind(window.history);
    let lastReplaceTs = 0;
    const REPLACE_THROTTLE_MS = 5_000;

    window.history.pushState = function (...args: Parameters<History["pushState"]>) {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_router_navigate",
        level: "warning",
        metadata: { method: "pushState", url: String(args[2] ?? ""), status: statusRef.current },
      });
      return origPush(...args);
    };

    window.history.replaceState = function (...args: Parameters<History["replaceState"]>) {
      const now = Date.now();
      if (now - lastReplaceTs >= REPLACE_THROTTLE_MS) {
        lastReplaceTs = now;
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "mobile_router_navigate",
          level: "info",
          metadata: { method: "replaceState", url: String(args[2] ?? ""), status: statusRef.current },
        });
      }
      return origReplace(...args);
    };

    return () => {
      window.history.pushState    = origPush;
      window.history.replaceState = origReplace;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 7: Page visibility / iOS background-tab lifecycle
  useEffect(() => {
    function onVisibilityChange() {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_visibility_changed",
        // hidden = page went to background; relevant for iOS Safari tab suspension
        level: document.visibilityState === "hidden" ? "warning" : "info",
        metadata: { visibilityState: document.visibilityState, status: statusRef.current },
      });
    }

    function onPageHide(e: PageTransitionEvent) {
      // sendBeacon is used by trackClientSessionEvent — fires even on iOS discard.
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_page_hide",
        // persisted=true means it entered BFCache; false means fully discarded.
        level: "warning",
        metadata: { persisted: e.persisted, status: statusRef.current },
      });
    }

    function onPageShow(e: PageTransitionEvent) {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_page_show",
        // persisted=true = restored from BFCache; can cause stale React state.
        level: e.persisted ? "warning" : "info",
        metadata: { persisted: e.persisted, status: statusRef.current },
      });
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 6: Uncaught JS errors + unhandled promise rejections
  useEffect(() => {
    function onError(e: ErrorEvent) {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_js_error",
        level: "error",
        message: e.message || "unknown error",
        metadata: {
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          status: statusRef.current,
        },
      });
    }

    function onUnhandledRejection(e: PromiseRejectionEvent) {
      const msg =
        e.reason instanceof Error
          ? e.reason.message
          : typeof e.reason === "string"
            ? e.reason
            : "Unhandled promise rejection";
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_unhandled_rejection",
        level: "error",
        message: msg,
        metadata: { status: statusRef.current },
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3 + 5: Called before each session fetch.
  // Records the timestamp and emits MOBILE_EXCESSIVE_POLLING if the rate
  // exceeds the threshold. Does NOT emit a per-fetch event — the existing
  // mobile_fetch_started in useMobileSession covers that.
  const trackFetch = useCallback(() => {
    const now = Date.now();

    // Slide the window: drop timestamps older than the window
    fetchTs.current = fetchTs.current.filter((t) => now - t < EXCESSIVE_FETCH_WINDOW_MS);
    fetchTs.current.push(now);

    if (!excessiveFlagSent.current && fetchTs.current.length >= EXCESSIVE_FETCH_THRESHOLD) {
      excessiveFlagSent.current = true;
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_excessive_polling_detected",
        level: "warning",
        code: "MOBILE_EXCESSIVE_POLLING",
        metadata: {
          fetchCount: fetchTs.current.length,
          windowMs: EXCESSIVE_FETCH_WINDOW_MS,
          status: statusRef.current,
        },
      });
    }

    // Reset so we can re-detect if the burst resumes after a quiet period
    if (excessiveFlagSent.current && fetchTs.current.length < EXCESSIVE_FETCH_THRESHOLD) {
      excessiveFlagSent.current = false;
    }
  }, [sessionId]);

  // Lets useMobileSession keep the status ref up-to-date without re-running effects
  const updateStatus = useCallback((status: string | null) => {
    statusRef.current = status;
  }, []);

  return { trackFetch, updateStatus };
}
