"use client";

import {
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  fetchRoomPreviewSession,
  isRoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import {
  getCustomerRecoveryMessage,
  type CustomerRecoveryMessage,
} from "@/lib/room-preview/customer-recovery";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { MobileSessionViewState } from "@/features/room-preview/mobile/mobile-session-utils";

/**
 * Browser-Back guard.
 *
 * Push a duplicate history entry on mount. When the user presses Back, the
 * browser moves to the original (same URL) and fires popstate — we catch it,
 * re-push to keep the guard alive, then re-fetch the authoritative session
 * state and update the view accordingly.
 *
 * The body is moved verbatim from `useMobileSession.ts`:
 *
 *   - The `sessionRef` always-current ref is now owned here (it was only ever
 *     read by `handlePopState` to surface the current status in `back_pressed`
 *     event metadata).
 *   - `back_pressed` and `redirected_to_correct_step` events keep identical
 *     metadata shapes.
 *   - The Arabic success toast `"أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك"`
 *     is preserved verbatim with its 4-second auto-clear.
 *   - The `failed → retry_render` recovery branch, the `result_ready →
 *     setShowResult(true)` branch, and the silent network-error fallback are
 *     all preserved.
 */
export interface UseBrowserBackGuardParams {
  session: RoomPreviewSession | null;
  setSession: Dispatch<SetStateAction<RoomPreviewSession | null>>;
  setViewState: Dispatch<SetStateAction<MobileSessionViewState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setRecoveryMessage: Dispatch<SetStateAction<CustomerRecoveryMessage | null>>;
  setShowResult: Dispatch<SetStateAction<boolean>>;
  sessionId: string;
  t: TranslationDictionary;
}

export function useBrowserBackGuard(params: UseBrowserBackGuardParams): void {
  const {
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setShowResult,
    sessionId,
    t,
  } = params;

  // Always-current ref so the popstate handler reads fresh session state
  // without being re-registered on every render.
  const sessionRef = useRef<RoomPreviewSession | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    window.history.pushState(null, "");

    function handlePopState() {
      // Restore guard so every subsequent Back press is also caught.
      window.history.pushState(null, "");

      const currentPath = window.location.pathname;

      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "back_pressed",
        level: "info",
        metadata: {
          currentPath,
          currentStatus: sessionRef.current?.status ?? null,
          timestamp: new Date().toISOString(),
        },
      });

      void (async () => {
        try {
          const fresh = await fetchRoomPreviewSession(sessionId);
          setSession(fresh);

          const { status } = fresh;

          if (status === "expired" || status === "completed") {
            setViewState("expired");
            setError(null);
          } else if (status === "failed") {
            setViewState("ready");
            const recovery = getCustomerRecoveryMessage("retry_render");
            setRecoveryMessage(recovery);
            setError(recovery?.text ?? t.roomPreview.mobile.loadFailed);
          } else {
            setViewState("ready");
            if (status === "result_ready" && fresh.renderResult?.imageUrl) {
              setShowResult(true);
            }
          }

          // Confirm to the user that we kept them in flow.
          const msg = "أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك";
          setSuccessMessage(msg);
          setTimeout(
            () => setSuccessMessage((prev) => (prev === msg ? null : prev)),
            4_000,
          );

          trackClientSessionEvent(sessionId, {
            source: "mobile",
            eventType: "redirected_to_correct_step",
            level: "info",
            metadata: {
              fromPath: currentPath,
              toPath: currentPath,
              status,
              reason: "browser_back_recovery",
            },
          });
        } catch (err) {
          if (isRoomPreviewRequestError(err)) {
            if (err.code === "not_found") setViewState("not_found");
            else if (err.code === "expired") setViewState("expired");
            // Network error: silently stay on current view — Back guard must
            // never crash or freeze the UI.
          }
        }
      })();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
