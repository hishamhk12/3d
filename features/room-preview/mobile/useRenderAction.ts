"use client";

import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  createRenderForSession,
  isRoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import { pollForRenderResult } from "@/lib/room-preview/session-polling";
import {
  getCustomerRecoveryMessage,
  type CustomerRecoveryMessage,
} from "@/lib/room-preview/customer-recovery";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { LogLevel } from "@/features/room-preview/mobile/debug";
import {
  getViewStateFromError,
  type MobileSessionViewState,
} from "@/features/room-preview/mobile/mobile-session-utils";
import {
  getErrorMessage,
  hasRequestErrorCode,
} from "@/features/room-preview/mobile/mobile-session-error-utils";

/**
 * Owns the render-request in-flight guard and the `handleCreateRender`
 * action. The body is moved verbatim from `useMobileSession.ts` — identical
 * pre-flight checks, identical diagnostics events, identical Arabic strings,
 * identical recovery-message selection, and identical
 * render-limit / device-cooldown / screen-budget / timeout cascade.
 *
 * State that is shared with the product-selection flow (`productSavePromiseRef`,
 * `isSavingProductRef`, `setIsSavingProduct` wrapper) and the restart flow
 * (`restartDoneRef`) is passed in by the parent instead of being owned here.
 */
export interface UseRenderActionParams {
  session: RoomPreviewSession | null;
  setSession: Dispatch<SetStateAction<RoomPreviewSession | null>>;
  setViewState: Dispatch<SetStateAction<MobileSessionViewState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setRecoveryMessage: Dispatch<SetStateAction<CustomerRecoveryMessage | null>>;
  setShowResult: Dispatch<SetStateAction<boolean>>;
  /** Wrapper that updates both the ref (sync) and the `isSavingProduct` useState. */
  setIsSavingProduct: (v: boolean) => void;
  /** Shared with the restart flow; render is blocked once this is true. */
  restartDoneRef: MutableRefObject<boolean>;
  /** Shared with handleProductSelect; awaited before the render request runs. */
  productSavePromiseRef: MutableRefObject<Promise<RoomPreviewSession | null> | null>;
  /** Shared with the product-save state; render aborts if true after the await. */
  isSavingProductRef: MutableRefObject<boolean>;
  sessionId: string;
  t: TranslationDictionary;
  debugLog: (level: LogLevel, message: string, detail?: string) => void;
}

export interface UseRenderActionReturn {
  handleCreateRender: (sessionOverride?: RoomPreviewSession) => Promise<void>;
}

export function useRenderAction(params: UseRenderActionParams): UseRenderActionReturn {
  const {
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setShowResult,
    setIsSavingProduct,
    restartDoneRef,
    productSavePromiseRef,
    isSavingProductRef,
    sessionId,
    t,
    debugLog,
  } = params;

  const renderRequestInFlightRef = useRef(false);

  const handleCreateRender = useCallback(async (sessionOverride?: RoomPreviewSession) => {
    // Block all render attempts once the customer has started a new-session restart.
    if (restartDoneRef.current) {
      debugLog("warn", "Render blocked — session restart already requested");
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "render_retry_blocked_after_restart",
        level: "warning",
        metadata: { sessionStatus: (sessionOverride ?? session)?.status ?? null },
      });
      return;
    }

    let activeSession = sessionOverride ?? session;

    console.log("[render] handler called", {
      productSaveInFlight: productSavePromiseRef.current !== null,
      inFlight: renderRequestInFlightRef.current,
      isSavingProduct: isSavingProductRef.current,
      sessionStatus: activeSession?.status ?? null,
      sessionId,
    });

    // ── Wait for any in-flight product save ────────────────────────────────────
    // With immediate-send (no debounce), the product POST is already running by
    // the time the user taps render. Await it so the session is up-to-date before
    // checking guard conditions and proceeding with render.
    if (productSavePromiseRef.current !== null) {
      debugLog("network", "Waiting for in-flight product save before render");
      const savedSession = await productSavePromiseRef.current;
      if (savedSession) {
        activeSession = savedSession;
      }
    }

    if (
      renderRequestInFlightRef.current ||
      isSavingProductRef.current ||
      !activeSession ||
      activeSession.status === "ready_to_render" ||
      activeSession.status === "rendering"
    ) {
      const blockedBy = renderRequestInFlightRef.current
        ? "in_flight"
        : isSavingProductRef.current
          ? "is_saving_product"
          : !activeSession
            ? "no_session"
            : "already_rendering";
      console.log("[render] early return", { blockedBy, status: activeSession?.status });
      debugLog("warn", `Ignored duplicate render request (blockedBy: ${blockedBy})`);
      if (blockedBy === "already_rendering") {
        setError("المعاينة لا تزال قيد الإنشاء، يرجى الانتظار قليلًا.");
      }
      return;
    }

    renderRequestInFlightRef.current = true;
    const renderSession = activeSession;

    trackClientSessionEvent(renderSession.id, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "render" },
    });
    setIsSavingProduct(true);
    setError(null);
    setSuccessMessage(null);
    setRecoveryMessage(null);
    debugLog("network", `POST /render  sessionId: ${renderSession.id}`);

    const renderMetadataBase = {
      sessionId: renderSession.id,
      currentStatus: renderSession.status,
      hasRoomImage: Boolean(renderSession.selectedRoom?.imageUrl),
      hasProduct: Boolean(renderSession.selectedProduct?.id && renderSession.selectedProduct?.imageUrl),
      productId: renderSession.selectedProduct?.id ?? null,
      endpoint: `/api/room-preview/sessions/${renderSession.id}/render`,
    };

    console.log("[render] request started", renderMetadataBase);
    trackClientSessionEvent(renderSession.id, {
      source: "mobile",
      eventType: "render_request_started",
      level: "info",
      metadata: renderMetadataBase,
    });

    try {
      // Returns immediately (202) with session in ready_to_render state.
      const renderingSession = await createRenderForSession(renderSession.id);
      setSession(renderingSession);
      debugLog("success", "Render started — polling for result");

      trackClientSessionEvent(renderSession.id, {
        source: "mobile",
        eventType: "render_request_accepted",
        level: "info",
        metadata: { ...renderMetadataBase, statusAfter: renderingSession.status },
      });

      // Poll until the server pushes result_ready or failed via DB.
      const finalSession = await pollForRenderResult(renderSession.id, undefined, {
        onUpdate(nextSession) {
          setSession(nextSession);
        },
      });
      setSession(finalSession);

      if (finalSession.status === "result_ready") {
        setShowResult(true);
        setSuccessMessage(t.roomPreview.mobile.product.saveSuccess);
        debugLog("success", "Render complete");
      } else {
        debugLog("error", "Render pipeline failed — session marked failed");
        const recovery = getCustomerRecoveryMessage("retry_render");
        setRecoveryMessage(recovery);
        setError("فشل إنشاء التصميم. يرجى المحاولة مرة أخرى.");
        trackClientSessionEvent(renderSession.id, {
          source: "mobile",
          eventType: "failure_recovery_ui_shown",
          level: "warning",
          metadata: { reason: "render_pipeline_failed", status: finalSession.status },
        });
      }
    } catch (renderError) {
      const failure = getViewStateFromError(renderError, t);
      debugLog("error", `Render error: ${getErrorMessage(renderError)}`);

      trackClientSessionEvent(renderSession.id, {
        source: "mobile",
        eventType: "render_request_failed",
        level: "error",
        code: isRoomPreviewRequestError(renderError) ? String(renderError.code) : "UNKNOWN",
        message: getErrorMessage(renderError),
        metadata: {
          ...renderMetadataBase,
          status: isRoomPreviewRequestError(renderError) ? renderError.status : null,
          errorMessage: getErrorMessage(renderError),
        },
      });

      // Expired / not-found sessions cannot be retried — transition viewState
      // so the UI shows the appropriate panel rather than a retry button.
      if (hasRequestErrorCode(renderError, "expired") || hasRequestErrorCode(renderError, "not_found")) {
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        setRecoveryMessage(null);
        return;
      }

      if (hasRequestErrorCode(renderError, "render_limit_reached")) {
        // Both buttons must always appear; use retry_render so the primary CTA retries the render.
        setError("فشل التصميم أكثر من مرة.");
        setRecoveryMessage(getCustomerRecoveryMessage("retry_render"));
        trackClientSessionEvent(renderSession.id, {
          source: "mobile",
          eventType: "failure_recovery_ui_shown",
          level: "warning",
          metadata: { reason: "render_limit_reached", status: renderSession.status },
        });
      } else if (hasRequestErrorCode(renderError, "render_device_cooldown")) {
        // Show retry button even on cooldown — user decides when to tap again.
        setError("يمكنك طلب معاينة جديدة بعد ٥ دقائق.");
        setRecoveryMessage(getCustomerRecoveryMessage("retry_render"));
        trackClientSessionEvent(renderSession.id, {
          source: "mobile",
          eventType: "failure_recovery_ui_shown",
          level: "warning",
          metadata: { reason: "render_device_cooldown", status: renderSession.status },
        });
      } else if (hasRequestErrorCode(renderError, "screen_budget_exhausted")) {
        // Daily screen budget is truly exhausted — retry would fail too; only new session helps.
        setError("انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص.");
        setRecoveryMessage(null);
        trackClientSessionEvent(renderSession.id, {
          source: "mobile",
          eventType: "failure_recovery_ui_shown",
          level: "warning",
          metadata: { reason: "screen_budget_exhausted", status: renderSession.status },
        });
      } else {
        // Timeout and all other render errors — always use retry_render for a consistent two-button UI.
        const isTimeout = hasRequestErrorCode(renderError, "timeout");
        setRecoveryMessage(getCustomerRecoveryMessage("retry_render"));
        setError(
          isTimeout
            ? "فشل إنشاء التصميم أو استغرق وقتًا طويلًا."
            : "فشل إنشاء التصميم. يرجى المحاولة مرة أخرى.",
        );
        trackClientSessionEvent(renderSession.id, {
          source: "mobile",
          eventType: "failure_recovery_ui_shown",
          level: "warning",
          metadata: { reason: isTimeout ? "render_timeout" : "render_failed", status: renderSession.status },
        });
      }
      trackClientSessionEvent(renderSession.id, {
        source: "mobile",
        eventType: hasRequestErrorCode(renderError, "timeout")
          ? "render_timeout"
          : "render_failed",
        level: "error",
        code: hasRequestErrorCode(renderError, "timeout")
          ? "RENDER_TIMEOUT"
          : "RENDER_FAILED",
        message: getErrorMessage(renderError),
      });
    } finally {
      renderRequestInFlightRef.current = false;
      setIsSavingProduct(false);
    }
  }, [
    session,
    sessionId,
    t,
    debugLog,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setShowResult,
    setIsSavingProduct,
    restartDoneRef,
    productSavePromiseRef,
    isSavingProductRef,
  ]);

  return { handleCreateRender };
}
