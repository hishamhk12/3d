"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import {
  connectRoomPreviewSession,
  fetchRoomPreviewSession,
  getRoomPreviewErrorLogDetails,
  isRoomPreviewRequestError,
  createRenderForSession,
} from "@/lib/room-preview/session-client";
import { saveRoomPreviewSessionProduct } from "@/lib/room-preview/product-service";
import {
  saveRoomPreviewSessionRoom,
  requestDirectUploadUrl,
  uploadFileToR2,
  confirmDirectUpload,
} from "@/lib/room-preview/room-service";
import { compressRoomImage } from "@/lib/room-preview/image-compress";
import { pollForRenderResult } from "@/lib/room-preview/session-polling";
import { getCustomerRecoveryMessage, type CustomerRecoveryMessage } from "@/lib/room-preview/customer-recovery";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import { useDebugLog } from "@/features/room-preview/mobile/debug";
import type { LogEntry } from "@/features/room-preview/mobile/debug";
import { useMobileDiagnostics } from "@/features/room-preview/mobile/useMobileDiagnostics";
import { useMobileHeartbeat } from "@/features/room-preview/mobile/useMobileHeartbeat";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type {
  RoomPreviewRoomSource,
  RoomPreviewSession,
} from "@/lib/room-preview/types";
import {
  createActionErrorMessage,
  getViewStateFromError,
  isNetworkInterrupted,
  isSessionConnected,
  MOBILE_INITIAL_LOAD_MAX_ATTEMPTS,
  MOBILE_INITIAL_LOAD_RETRY_DELAY_MS,
  MOBILE_NETWORK_ERROR_MESSAGE,
  wait,
  type MobileSessionViewState,
  type SaveStatus,
} from "@/features/room-preview/mobile/mobile-session-utils";
import {
  getErrorMessage,
  getRequestErrorCode,
  hasRequestErrorCode,
} from "@/features/room-preview/mobile/mobile-session-error-utils";
import { useMobileConnect } from "@/features/room-preview/mobile/useMobileConnect";
import { useRoomUpload } from "@/features/room-preview/mobile/useRoomUpload";
import { useRenderAction } from "@/features/room-preview/mobile/useRenderAction";
import { useProductSelection } from "@/features/room-preview/mobile/useProductSelection";
import { useMobileSessionEvents } from "@/features/room-preview/mobile/useMobileSessionEvents";
import { useBrowserBackGuard } from "@/features/room-preview/mobile/useBrowserBackGuard";
import { useSessionExpiryTimer } from "@/features/room-preview/mobile/useSessionExpiryTimer";

// Re-export the view-state and save-status types so external code can keep
// importing them from useMobileSession (preserves the original public API).
export type { MobileSessionViewState, SaveStatus };

export interface UseMobileSessionReturn {
  // i18n (for use in the orchestrator and step components)
  t: TranslationDictionary;
  locale: "ar" | "en";
  dir: "ltr" | "rtl";
  formatMessage: (template: string, params: Record<string, string>) => string;

  // State
  session: RoomPreviewSession | null;
  viewState: MobileSessionViewState;
  isConnecting: boolean;
  isSavingRoom: boolean;
  isSavingProduct: boolean;
  showResult: boolean;
  setShowResult: (v: boolean) => void;
  roomSaveStatusLabel: string | null;
  error: string | null;
  successMessage: string | null;
  roomSaveStatus: SaveStatus;
  productSaveStatus: SaveStatus;
  recoveryMessage: CustomerRecoveryMessage | null;
  clearRecoveryMessage: () => void;
  /** True once the customer confirms they want a brand-new session (restart flow). */
  restartDone: boolean;
  /** Call after the abandon API succeeds to lock out further render requests. */
  markRestartDone: () => void;

  // Derived
  isConnected: boolean;
  hasSavedRoom: boolean;
  hasSavedProduct: boolean;
  localProductId: string | null;
  sectionAlignClass: string;
  fileInputSpacingClass: string;
  inlineSpinnerSpacingClass: string;

  // Actions
  retry: () => void;
  handleConnect: () => Promise<void>;
  handleFileSelection: (source: Extract<RoomPreviewRoomSource, "camera" | "gallery">, file: File | null) => Promise<void>;
  retryRoomUpload: () => Promise<boolean>;
  handleProductSelect: (productId: string) => void;
  handleProductCodeSelect: (productCode: string) => Promise<RoomPreviewSession | null>;
  handleCreateRender: (sessionOverride?: RoomPreviewSession) => Promise<void>;
  handleRetakeRoomPhoto: () => void;

  // Heartbeat
  heartbeatConnected: boolean;
  heartbeatFailedCount: number;
  heartbeatLastSuccessAt: number | null;

  // Debug
  debugEntries: LogEntry[];
  clearDebugLog: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMobileSession({
  sessionId,
}: {
  sessionId: string;
}): UseMobileSessionReturn {
  const { dir, formatMessage, locale, t } = useI18n();

  const [session,             setSession]            = useState<RoomPreviewSession | null>(null);
  const [viewState,           setViewState]          = useState<MobileSessionViewState>("loading");
  const [loadAttempt,         setLoadAttempt]        = useState(0);
  const [isSavingProduct,     _setIsSavingProduct]   = useState(false);
  const isSavingProductRef = useRef(false);
  const setIsSavingProduct = (v: boolean) => { isSavingProductRef.current = v; _setIsSavingProduct(v); };
  const productSavePromiseRef = useRef<Promise<RoomPreviewSession | null> | null>(null);
  const [showResult,          setShowResult]         = useState(false);
  const [roomSaveStatusLabel, setRoomSaveStatusLabel]= useState<string | null>(null);
  const [error,               setError]              = useState<string | null>(null);
  const [successMessage,      setSuccessMessage]     = useState<string | null>(null);
  const [roomSaveStatus,      setRoomSaveStatus]     = useState<SaveStatus>("idle");
  const [productSaveStatus,   setProductSaveStatus]  = useState<SaveStatus>("idle");
  const [recoveryMessage,     setRecoveryMessage]    = useState<CustomerRecoveryMessage | null>(null);
  // Latched to true once the customer triggers the "new session" restart flow.
  // Blocks any further render requests from the current mobile page.
  const restartDoneRef = useRef(false);
  const [restartDone, setRestartDone] = useState(false);

  const { entries: debugEntries, add: debugLog, clear: clearDebugLog } = useDebugLog();
  const { trackFetch, updateStatus } = useMobileDiagnostics(sessionId);
  const {
    isConnected: heartbeatConnected,
    failedCount: heartbeatFailedCount,
    lastSuccessAt: heartbeatLastSuccessAt,
  } = useMobileHeartbeat(sessionId, session?.status);

  const { isConnecting, handleConnect } = useMobileConnect({
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRoomSaveStatus,
    setProductSaveStatus,
    setRoomSaveStatusLabel,
    sessionId,
    t,
    debugLog,
  });

  const { isSavingRoom, handleFileSelection, retryRoomUpload } = useRoomUpload({
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setRoomSaveStatus,
    setProductSaveStatus,
    setRoomSaveStatusLabel,
    sessionId,
    t,
    debugLog,
  });

  const { localProductId, handleProductSelect, handleProductCodeSelect } = useProductSelection({
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setProductSaveStatus,
    setIsSavingProduct,
    productSavePromiseRef,
    sessionId,
    t,
    debugLog,
  });

  const { handleCreateRender } = useRenderAction({
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
  });

  useMobileSessionEvents({
    session,
    sessionId,
    showResult,
    heartbeatConnected,
    heartbeatFailedCount,
    updateStatus,
    debugLog,
  });

  useBrowserBackGuard({
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setShowResult,
    sessionId,
    t,
  });

  useSessionExpiryTimer({
    session,
    viewState,
    setSession,
    setError,
    setViewState,
  });

  // ── Initial session load ─────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function loadSession() {
      setViewState("loading");
      setError(null);
      setSuccessMessage(null);
      setRoomSaveStatus("idle");
      setProductSaveStatus("idle");
      setRoomSaveStatusLabel(null);
      setRecoveryMessage(null);

      const url = `/api/room-preview/sessions/${sessionId}`;
      for (let attempt = 1; attempt <= MOBILE_INITIAL_LOAD_MAX_ATTEMPTS; attempt += 1) {
        const isLastAttempt = attempt === MOBILE_INITIAL_LOAD_MAX_ATTEMPTS;

        debugLog("network", `GET ${url}`, `attempt #${attempt}`);
        trackFetch(); // timestamps this fetch; emits MOBILE_EXCESSIVE_POLLING if burst detected
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "mobile_fetch_started",
          level: "info",
          metadata: { attempt, loadAttempt: loadAttempt + 1, url },
        });

        try {
          const nextSession = await fetchRoomPreviewSession(sessionId);

        if (!active) return;

        let finalSession = nextSession;

        // Auto-connect here to skip the manual "I am connected" button on mobile
        if (!isSessionConnected(nextSession)) {
          const connectUrl = `/api/room-preview/sessions/${sessionId}/connect`;
          debugLog("network", `Auto-connecting session: ${sessionId}`);
          console.info("[room-preview] mobile_connect_started", {
            mode: "auto",
            sessionId,
            statusBefore: nextSession.status,
            url: connectUrl,
          });
          trackClientSessionEvent(sessionId, {
            source: "mobile",
            eventType: "mobile_connect_started",
            level: "info",
            statusBefore: nextSession.status,
            metadata: { attempt, mode: "auto", url: connectUrl },
          });
          try {
            finalSession = await connectRoomPreviewSession(sessionId);
            console.info("[room-preview] mobile_connect_success", {
              mode: "auto",
              sessionId,
              statusAfter: finalSession.status,
              url: connectUrl,
            });
            trackClientSessionEvent(sessionId, {
              source: "mobile",
              eventType: "mobile_connect_success",
              level: "info",
              statusAfter: finalSession.status,
              metadata: { attempt, mode: "auto", url: connectUrl },
            });
            debugLog("success", "Auto-connected successfully");
          } catch (autoConnectError) {
            console.error("[room-preview] mobile_connect_failed", {
              error: getErrorMessage(autoConnectError),
              mode: "auto",
              sessionId,
              url: connectUrl,
            });
            trackClientSessionEvent(sessionId, {
              source: "mobile",
              eventType: "mobile_connect_failed",
              level: "error",
              code: isRoomPreviewRequestError(autoConnectError)
                ? autoConnectError.code
                : isNetworkInterrupted(autoConnectError)
                  ? "NETWORK_INTERRUPTED"
                  : null,
              message: getErrorMessage(autoConnectError),
              statusBefore: nextSession.status,
              metadata: { attempt, mode: "auto", url: connectUrl },
            });
            debugLog("error", `Failed to auto-connect session: ${getErrorMessage(autoConnectError)}`);
            trackClientSessionEvent(sessionId, {
              source: "mobile",
              eventType: "mobile_auto_connect_failed",
              level: "error",
              code: isNetworkInterrupted(autoConnectError) ? "NETWORK_INTERRUPTED" : null,
              message: getErrorMessage(autoConnectError),
              metadata: { attempt, loadAttempt: loadAttempt + 1, url: connectUrl },
            });
            throw autoConnectError;
          }
        }

        debugLog("success", `Session loaded — status: ${finalSession.status}`);
        debugLog("state",   `viewState → ready`);
        setSession(finalSession);
        setViewState("ready");
        return;
      } catch (loadError) {
        if (!active) return;

        const networkInterrupted = isNetworkInterrupted(loadError);
        const failedUrl =
          isRoomPreviewRequestError(loadError) && loadError.status === 401
            ? `/api/room-preview/sessions/${sessionId}/connect`
            : url;
        const isTypeFailed =
          networkInterrupted;

        debugLog(
          "error",
          isTypeFailed
            ? "TypeError: Failed to fetch (firewall / wrong network?)"
            : `Fetch error: ${getErrorMessage(loadError)}`,
          loadError instanceof Error
            ? `code: ${isRoomPreviewRequestError(loadError) ? loadError.code : "n/a"} url: ${failedUrl}`
            : `url: ${failedUrl}`,
        );

        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "mobile_fetch_failed_with_url",
          level: "error",
          code: networkInterrupted ? "NETWORK_INTERRUPTED" : null,
          message: getErrorMessage(loadError),
          metadata: { attempt, loadAttempt: loadAttempt + 1, url: failedUrl },
        });

        if (networkInterrupted && !isLastAttempt) {
          trackClientSessionEvent(sessionId, {
            source: "mobile",
            eventType: "mobile_retry_started",
            level: "warning",
            code: "NETWORK_INTERRUPTED",
            message: "Retrying mobile session fetch without reloading the page.",
            metadata: {
              attempt,
              nextAttempt: attempt + 1,
              retryDelayMs: MOBILE_INITIAL_LOAD_RETRY_DELAY_MS,
              url: failedUrl,
            },
          });
          await wait(MOBILE_INITIAL_LOAD_RETRY_DELAY_MS);
          continue;
        }

        if (networkInterrupted) {
          trackClientSessionEvent(sessionId, {
            source: "mobile",
            eventType: "mobile_retry_exhausted",
            level: "error",
            code: "NETWORK_INTERRUPTED",
            message: "Mobile session fetch failed after all in-page retry attempts.",
            metadata: { attempts: MOBILE_INITIAL_LOAD_MAX_ATTEMPTS, url: failedUrl },
          });
        }

        const failure = networkInterrupted
          ? { state: "failed" as const, message: MOBILE_NETWORK_ERROR_MESSAGE }
          : getViewStateFromError(loadError, t);
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "mobile_fetch_failed",
          level: "error",
          code: networkInterrupted ? "NETWORK_INTERRUPTED" : null,
          message: getErrorMessage(loadError),
          metadata: { attempt, loadAttempt: loadAttempt + 1, url: failedUrl },
        });
        debugLog("state", `viewState → ${failure.state}`);
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        return;
      }
    }
    }

    void loadSession();
    return () => { active = false; };
  }, [loadAttempt, sessionId, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const shouldResumeRender =
      session?.status === "ready_to_render" || session?.status === "rendering";

    if (!session || !shouldResumeRender || isSavingProduct || showResult) {
      return;
    }

    let active = true;
    setIsSavingProduct(true);
    setError(null);
    setSuccessMessage(null);
    debugLog("network", `Resuming render polling  sessionId: ${session.id}`);

    pollForRenderResult(session.id, undefined, {
      onUpdate(nextSession) {
        if (!active) return;
        setSession(nextSession);
      },
    })
      .then((finalSession) => {
        if (!active) return;
        setSession(finalSession);

        if (finalSession.status === "result_ready") {
          setShowResult(true);
          setSuccessMessage(t.roomPreview.mobile.product.saveSuccess);
          debugLog("success", "Render complete after resume");
        } else {
          debugLog("error", "Render pipeline failed after resume");
          const resumeRecovery = getCustomerRecoveryMessage("retry_render");
          setRecoveryMessage(resumeRecovery);
          setError("فشل إنشاء التصميم. يرجى المحاولة مرة أخرى.");
          trackClientSessionEvent(session.id, {
            source: "mobile",
            eventType: "failure_recovery_ui_shown",
            level: "warning",
            metadata: { reason: "render_pipeline_failed_after_resume", status: finalSession.status },
          });
        }
      })
      .catch((renderError) => {
        if (!active) return;
        const failure = getViewStateFromError(renderError, t);
        debugLog("error", `Render resume error: ${getErrorMessage(renderError)}`);
        setError(failure.message);
      })
      .finally(() => {
        if (!active) return;
        setIsSavingProduct(false);
      });

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, showResult]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleRetakeRoomPhoto = useCallback(() => {
    if (!session) return;
    setSession({ ...session, selectedRoom: null });
    setError(null);
    setRecoveryMessage(null);
  }, [session]);

  const markRestartDone = useCallback(() => {
    restartDoneRef.current = true;
    setRestartDone(true);
  }, []);

  // ── Derived state ────────────────────────────────────────────────────────────

  const isConnected    = session ? isSessionConnected(session) : false;
  const hasSavedRoom   = Boolean(session?.selectedRoom?.imageUrl);
  const hasSavedProduct = Boolean(
    session?.selectedProduct?.id && session?.selectedProduct?.imageUrl,
  );
  const effectiveLocalProductId = localProductId ?? session?.selectedProduct?.id ?? null;

  const sectionAlignClass         = dir === "rtl" ? "text-right" : "text-left";
  const fileInputSpacingClass      = dir === "rtl" ? "file:ml-3"  : "file:mr-3";
  const inlineSpinnerSpacingClass  = dir === "rtl" ? "ml-2"       : "mr-2";

  return {
    t,
    locale,
    dir,
    formatMessage,
    session,
    viewState,
    isConnecting,
    isSavingRoom,
    isSavingProduct,
    showResult,
    setShowResult,
    roomSaveStatusLabel,
    error,
    successMessage,
    roomSaveStatus,
    productSaveStatus,
    recoveryMessage,
    clearRecoveryMessage: () => setRecoveryMessage(null),
    restartDone,
    markRestartDone,
    isConnected,
    hasSavedRoom,
    hasSavedProduct,
    localProductId: effectiveLocalProductId,
    sectionAlignClass,
    fileInputSpacingClass,
    inlineSpinnerSpacingClass,
    retry: () => setLoadAttempt((n) => n + 1),
    handleConnect,
    handleFileSelection,
    retryRoomUpload,
    handleProductSelect,
    handleProductCodeSelect,
    handleCreateRender,
    handleRetakeRoomPhoto,
    heartbeatConnected,
    heartbeatFailedCount,
    heartbeatLastSuccessAt,
    debugEntries,
    clearDebugLog,
  };
}
