import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import type { RoomPreviewSessionStatus } from "@/lib/room-preview/types";

type ClientSessionEventLevel = "info" | "warning" | "error" | "fatal";
type ClientSessionEventSource = "mobile" | "screen";

export type ClientSessionEventInput = {
  code?: string | null;
  eventType: string;
  level?: ClientSessionEventLevel;
  message?: string | null;
  metadata?: unknown;
  source: ClientSessionEventSource;
  statusAfter?: RoomPreviewSessionStatus | string | null;
  statusBefore?: RoomPreviewSessionStatus | string | null;
};

// ─── Client-side throttle ─────────────────────────────────────────────────────
//
// Prevents the same low-value event from hitting the server more than once
// every THROTTLE_MS milliseconds.  The map is module-level so it persists
// for the lifetime of the browser tab and is shared across all components
// that import this module.
//
// Key: `${sessionId}:${eventType}`  Value: timestamp of last emission (ms)

const THROTTLE_MS = 5_000;
const _lastSent = new Map<string, number>();

// Events that carry unique/actionable data and must never be suppressed.
// Everything NOT in this set is subject to the 5-second throttle.
const UNTHROTTLED_EVENTS = new Set([
  // Hard lifecycle — one-shot by nature
  "mobile_page_mounted",
  "mobile_page_unmounted",
  "screen_session_created",
  "screen_session_reused",
  // Problem detection — must arrive promptly for admin alerting
  "mobile_rapid_reload_detected",
  "mobile_excessive_polling_detected",
  "mobile_js_error",
  "mobile_unhandled_rejection",
  "screen_stale_detected",
  "duplicate_session_create_blocked",
  // User action events — tied to explicit user gestures
  "mobile_tap_detected",
  "room_upload_started",
  "room_upload_completed",
  "room_upload_failed",
  "room_upload_url_requested",
  "room_direct_upload_started",
  "room_direct_upload_confirmed",
  "room_direct_upload_failed",
  "product_selected",
  // Connection / session failure events
  "mobile_auto_connect_failed",
  "mobile_fetch_failed",
  // Render lifecycle (server-side, but also emitted from client)
  "render_started",
  "render_failed",
  "render_timeout",
  // Explicit connect
  "mobile_connected",
]);

// ─── Public API ───────────────────────────────────────────────────────────────

export function trackClientSessionEvent(
  sessionId: string,
  input: ClientSessionEventInput,
): void {
  // Throttle repeated low-value events before anything hits the network.
  if (!UNTHROTTLED_EVENTS.has(input.eventType)) {
    const key = `${sessionId}:${input.eventType}`;
    const now = Date.now();
    const last = _lastSent.get(key);

    if (last !== undefined && now - last < THROTTLE_MS) {
      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[diagnostics] throttled "${input.eventType}" (${now - last}ms since last send)`,
        );
      }
      return;
    }

    _lastSent.set(key, now);

    // Safety valve: if the map grows unusually large (many unique sessions in
    // one tab — shouldn't happen in normal use), reset it to prevent a memory
    // leak on very long-lived pages.
    if (_lastSent.size > 200) {
      _lastSent.clear();
    }
  }

  const body = JSON.stringify(input);
  const url = `${ROOM_PREVIEW_ROUTES.sessionApi(sessionId)}/diagnostics`;

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }

    void fetch(url, {
      method: "POST",
      body,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok && process.env.NODE_ENV === "development") {
          console.warn("[room-preview] Diagnostics request failed", {
            sessionId,
            status: response.status,
            url,
          });
        }
      })
      .catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("[room-preview] Diagnostics request failed", {
            error: error instanceof Error ? error.message : String(error),
            sessionId,
            url,
          });
        }
      });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[room-preview] Diagnostics request failed", {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        url,
      });
    }
    // Diagnostics must never affect the customer flow.
  }
}
