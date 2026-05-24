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

const MOBILE_NETWORK_ERROR_MESSAGE =
  "تعذر الاتصال بالسيرفر، تأكد أن الجوال والكمبيوتر على نفس الشبكة";
const MOBILE_INITIAL_LOAD_MAX_ATTEMPTS = 3;
const MOBILE_INITIAL_LOAD_RETRY_DELAY_MS = 1_500;

// ─── Types ────────────────────────────────────────────────────────────────────

export type MobileSessionViewState = "loading" | "ready" | "not_found" | "expired" | "failed";
export type SaveStatus = "idle" | "success" | "error";

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

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isSessionConnected(session: RoomPreviewSession) {
  return session.mobileConnected;
}

function getViewStateFromError(
  error: unknown,
  t: TranslationDictionary,
): { message: string; state: Exclude<MobileSessionViewState, "loading" | "ready"> } {
  if (isRoomPreviewRequestError(error)) {
    if (error.code === "not_found") return { state: "not_found", message: t.roomPreview.mobile.invalidLink };
    if (error.code === "expired")   return { state: "expired",   message: t.roomPreview.mobile.expiredLink };
    return { state: "failed", message: error.message };
  }
  return { state: "failed", message: t.roomPreview.mobile.loadFailed };
}

function createActionErrorMessage(error: unknown, fallbackMessage: string) {
  if (isRoomPreviewRequestError(error)) return error.message;
  return error instanceof Error ? error.message : fallbackMessage;
}

function wait(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isNetworkInterrupted(error: unknown) {
  return (
    (isRoomPreviewRequestError(error) && error.code === "network") ||
    (error instanceof TypeError && error.message === "Failed to fetch")
  );
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
  const [isConnecting,        setIsConnecting]       = useState(false);
  const [isSavingRoom,        setIsSavingRoom]       = useState(false);
  const [isSavingProduct,     _setIsSavingProduct]   = useState(false);
  const isSavingProductRef = useRef(false);
  const setIsSavingProduct = (v: boolean) => { isSavingProductRef.current = v; _setIsSavingProduct(v); };
  const [localProductId,      setLocalProductId]     = useState<string | null>(null);
  const productAbortRef       = useRef<AbortController | null>(null);
  const productSavePromiseRef = useRef<Promise<RoomPreviewSession | null> | null>(null);
  const [showResult,          setShowResult]         = useState(false);
  const [roomSaveStatusLabel, setRoomSaveStatusLabel]= useState<string | null>(null);
  const [error,               setError]              = useState<string | null>(null);
  const [successMessage,      setSuccessMessage]     = useState<string | null>(null);
  const [roomSaveStatus,      setRoomSaveStatus]     = useState<SaveStatus>("idle");
  const [productSaveStatus,   setProductSaveStatus]  = useState<SaveStatus>("idle");
  const [recoveryMessage,     setRecoveryMessage]    = useState<CustomerRecoveryMessage | null>(null);
  const renderRequestInFlightRef = useRef(false);
  // Always-current ref so the popstate handler reads fresh session state
  // without being re-registered on every render.
  const sessionRef = useRef<RoomPreviewSession | null>(null);
  sessionRef.current = session;

  const { entries: debugEntries, add: debugLog, clear: clearDebugLog } = useDebugLog();
  const { trackFetch, updateStatus } = useMobileDiagnostics(sessionId);
  const {
    isConnected: heartbeatConnected,
    failedCount: heartbeatFailedCount,
    lastSuccessAt: heartbeatLastSuccessAt,
  } = useMobileHeartbeat(sessionId, session?.status);

  // Track the first moment the heartbeat becomes unreachable (true → false).
  // Fire-once per disconnection event so we never spam the timeline.
  const prevHeartbeatConnectedRef = useRef(true);
  useEffect(() => {
    const wasConnected = prevHeartbeatConnectedRef.current;
    prevHeartbeatConnectedRef.current = heartbeatConnected;
    if (!heartbeatConnected && wasConnected) {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "weak_connection_warning_shown",
        level: "warning",
        metadata: { failedCount: heartbeatFailedCount },
      });
    }
  }, [heartbeatConnected, heartbeatFailedCount, sessionId]);

  // ── result_seen_mobile ────────────────────────────────────────────────────
  // Fires once per unique render result when the result UI first becomes
  // visible. The ref (keyed by imageUrl) prevents duplicate events from
  // polling re-renders, back-navigation recovery, or repeated setShowResult
  // calls with the same result.
  const resultSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showResult || !session) return;
    const imageUrl = session.renderResult?.imageUrl;
    if (!imageUrl) return;
    if (resultSeenRef.current === imageUrl) return;
    resultSeenRef.current = imageUrl;
    trackClientSessionEvent(session.id, {
      source: "mobile",
      eventType: "result_seen_mobile",
      level: "info",
      metadata: {
        status: session.status,
        hasResultImage: true,
        timestamp: new Date().toISOString(),
      },
    });
  }, [showResult, session]);

  // Keep the diagnostics status ref current for all async event listeners
  useEffect(() => {
    updateStatus(session?.status ?? null);
    if (session?.status) {
      console.info("[room-preview] mobile_session_status_changed", {
        mobileConnected: session.mobileConnected,
        sessionId,
        status: session.status,
      });
    }
  }, [session?.mobileConnected, session?.status, sessionId, updateStatus]);

  // ── Abort in-flight product save on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      productAbortRef.current?.abort();
    };
  }, []);

  // ── Lifecycle logging ────────────────────────────────────────────────────────
  useEffect(() => {
    debugLog("info", "MobileSessionClient mounted", `sessionId: ${sessionId}`);
    // mount_page_mounted is already sent by useMobileDiagnostics — no duplicate needed.
    return () => {
      debugLog("warn", "MobileSessionClient unmounting");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Browser Back guard ───────────────────────────────────────────────────────
  // Push a duplicate history entry on mount. When the user presses Back, the
  // browser moves to the original (same URL) and fires popstate — we catch it,
  // re-push to keep the guard alive, then re-fetch the authoritative session
  // state and update the view accordingly.
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
            setViewState("failed");
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
              error: autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError),
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
              message: autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError),
              statusBefore: nextSession.status,
              metadata: { attempt, mode: "auto", url: connectUrl },
            });
            debugLog("error", `Failed to auto-connect session: ${autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError)}`);
            trackClientSessionEvent(sessionId, {
              source: "mobile",
              eventType: "mobile_auto_connect_failed",
              level: "error",
              code: isNetworkInterrupted(autoConnectError) ? "NETWORK_INTERRUPTED" : null,
              message: autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError),
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
            : `Fetch error: ${loadError instanceof Error ? loadError.message : String(loadError)}`,
          loadError instanceof Error
            ? `code: ${isRoomPreviewRequestError(loadError) ? loadError.code : "n/a"} url: ${failedUrl}`
            : `url: ${failedUrl}`,
        );

        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "mobile_fetch_failed_with_url",
          level: "error",
          code: networkInterrupted ? "NETWORK_INTERRUPTED" : null,
          message: loadError instanceof Error ? loadError.message : String(loadError),
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
          message: loadError instanceof Error ? loadError.message : String(loadError),
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
          setError(t.roomPreview.mobile.loadFailed);
        }
      })
      .catch((renderError) => {
        if (!active) return;
        const failure = getViewStateFromError(renderError, t);
        debugLog("error", `Render resume error: ${renderError instanceof Error ? renderError.message : String(renderError)}`);
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

  const handleConnect = useCallback(async () => {
    if (isConnecting || !session || isSessionConnected(session)) return;

    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "connect" },
    });
    setIsConnecting(true);
    setError(null);
    setSuccessMessage(null);
    setRoomSaveStatus("idle");
    setProductSaveStatus("idle");
    setRoomSaveStatusLabel(null);

    debugLog("network", `POST /connect  sessionId: ${sessionId}`);
    console.info("[room-preview] mobile_connect_started", {
      mode: "manual",
      sessionId,
      statusBefore: session.status,
    });
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_connect_started",
      level: "info",
      statusBefore: session.status,
      metadata: { mode: "manual" },
    });

    try {
      const connectedSession = await connectRoomPreviewSession(sessionId);
      console.info("[room-preview] mobile_connect_success", {
        mode: "manual",
        sessionId,
        statusAfter: connectedSession.status,
      });
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_connect_success",
        level: "info",
        statusAfter: connectedSession.status,
        metadata: { mode: "manual" },
      });
      setSession({
        ...session,
        mobileConnected: true,
        status:
          session.selectedProduct?.id && session.selectedProduct?.imageUrl
            ? "product_selected"
            : session.selectedRoom?.imageUrl
              ? "room_selected"
              : "mobile_connected",
      });
      setSuccessMessage(t.roomPreview.mobile.connectedSuccess);
      debugLog("success", "Session connected");
    } catch (connectError) {
      const failure = getViewStateFromError(connectError, t);
      console.error("[room-preview] mobile_connect_failed", {
        error: connectError instanceof Error ? connectError.message : String(connectError),
        mode: "manual",
        sessionId,
      });
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_connect_failed",
        level: "error",
        code: isRoomPreviewRequestError(connectError)
          ? connectError.code
          : null,
        message: connectError instanceof Error ? connectError.message : String(connectError),
        statusBefore: session.status,
        metadata: { mode: "manual" },
      });
      debugLog("error", `Connect failed: ${connectError instanceof Error ? connectError.message : String(connectError)}`);

      if (failure.state === "expired" || failure.state === "not_found") {
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        debugLog("state", `viewState → ${failure.state}`);
      } else {
        setError(createActionErrorMessage(connectError, t.roomPreview.mobile.connectFailed));
      }
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, session, sessionId, t, debugLog]);

  const handleFileSelection = useCallback(async (
    source: Extract<RoomPreviewRoomSource, "camera" | "gallery">,
    file: File | null,
  ) => {
    if (!file || isSavingRoom || !session) {
      if (!file) {
        console.warn("[room-preview] Missing uploaded file", { sessionId, source });
        debugLog("warn", `handleFileSelection: no file selected (source: ${source})`);
        setRoomSaveStatus("error");
      }
      return;
    }

    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "room_upload", source, fileSize: file.size, fileType: file.type },
    });
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "room_upload_started",
      level: "info",
      metadata: { source, fileName: file.name, fileSize: file.size, fileType: file.type },
    });
    setIsSavingRoom(true);
    setError(null);
    setSuccessMessage(null);
    setRecoveryMessage(null);
    setRoomSaveStatus("idle");
    setProductSaveStatus("idle");
    setRoomSaveStatusLabel("جاري رفع صورة الغرفة...");

    const fileToUpload = await compressRoomImage(file);

    debugLog(
      "network",
      `uploading room  source: ${source}`,
      `file: ${file.name} (${file.size}b)  ${fileToUpload !== file ? `compressed → ${fileToUpload.name} (${fileToUpload.size}b, ${Math.round((1 - fileToUpload.size / file.size) * 100)}% smaller)` : "skipped compression (file already small)"}`,
    );

    try {
      // ── Step 1: request a signed upload URL from the server ───────────────
      let uploadUrlResponse;
      let usedDirectUpload = false;

      try {
        uploadUrlResponse = await requestDirectUploadUrl(sessionId, { source, file: fileToUpload });
        usedDirectUpload = true;
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "room_direct_upload_started",
          level: "info",
          metadata: { source, fileSize: fileToUpload.size, fileType: fileToUpload.type },
        });
        debugLog("network", `Got signed upload URL — PUT ${uploadUrlResponse.objectKey}`);
      } catch (urlError) {
        const isNotSupported =
          isRoomPreviewRequestError(urlError) &&
          urlError.status === 501;

        if (isNotSupported) {
          // Local / non-R2 dev environment — fall back to FormData upload
          debugLog("info", "Direct upload not supported, falling back to FormData upload");
        } else {
          throw urlError;
        }
      }

      let response;

      if (usedDirectUpload && uploadUrlResponse) {
        // ── Step 2: PUT file directly to R2 ────────────────────────────────
        await uploadFileToR2(
          uploadUrlResponse.uploadUrl,
          fileToUpload,
          {
            onProgress: (percent) => {
              setRoomSaveStatusLabel(`جاري رفع صورة الغرفة... ${percent}%`);
            },
            onR2Failure: ({ status, statusText, responseText, host }) => {
              trackClientSessionEvent(sessionId, {
                source: "mobile",
                eventType: "room_direct_upload_r2_failed",
                level: "error",
                code: status === 403 ? "R2_SIGNATURE_INVALID" : status === 0 ? "R2_CORS_OR_NETWORK" : "R2_PUT_FAILED",
                metadata: {
                  status,
                  statusText,
                  responseText: responseText.slice(0, 500),
                  host,
                  source,
                  fileType: fileToUpload.type,
                  fileSize: fileToUpload.size,
                },
              });
            },
          },
        );

        debugLog("success", `File uploaded to R2 (${fileToUpload.size}b)`);
        setRoomSaveStatusLabel("جاري رفع صورة الغرفة...");

        // ── Step 3: confirm the upload on the server ────────────────────────
        response = await confirmDirectUpload(sessionId, {
          objectKey: uploadUrlResponse.objectKey,
          publicUrl: uploadUrlResponse.publicUrl,
          source,
          file: fileToUpload,
        });

        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "room_direct_upload_confirmed",
          level: "info",
          metadata: { source, objectKey: uploadUrlResponse.objectKey },
        });
      } else {
        // ── Fallback: old FormData upload (development / non-R2) ────────────
        response = await saveRoomPreviewSessionRoom(
          sessionId,
          { source, file: fileToUpload, previousRoomImageUrl: session.selectedRoom?.imageUrl },
        );
      }

      setSession(response.session);
      setRoomSaveStatus("success");
      setRoomSaveStatusLabel(null);
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "room_upload_completed",
        level: "info",
        statusAfter: response.session.status,
        metadata: { source, directUpload: usedDirectUpload },
      });
      debugLog("success", `Room saved  source: ${response.session.selectedRoom?.source ?? "?"}`);
    } catch (saveError) {
      const failure = getViewStateFromError(saveError, t);
      debugLog("error", `Room upload failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`, `file: ${file.name}`);

      if (failure.state === "expired" || failure.state === "not_found") {
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        debugLog("state", `viewState → ${failure.state}`);
      } else {
        console.error(
          "[room-preview] Failed to save uploaded room",
          JSON.stringify({ error: JSON.parse(getRoomPreviewErrorLogDetails(saveError)), fileName: file.name, fileSize: file.size, fileType: file.type, sessionId, source }),
        );
        const recovery = isRoomPreviewRequestError(saveError) && saveError.status === 413
          ? getCustomerRecoveryMessage("image_too_large")
          : getCustomerRecoveryMessage("retry_upload");
        setRecoveryMessage(recovery);
        setError(
          recovery?.text ??
          (isRoomPreviewRequestError(saveError) && saveError.status === 403
            ? "انتهت صلاحية رابط الرفع، حاول مرة أخرى"
            : createActionErrorMessage(saveError, "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى")),
        );
        setRoomSaveStatus("error");
        setRoomSaveStatusLabel(null);
      }
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "room_upload_failed",
        level: "error",
        code: isRoomPreviewRequestError(saveError) ? saveError.code : null,
        message: saveError instanceof Error ? saveError.message : String(saveError),
        metadata: { source, fileName: file.name, fileSize: file.size, fileType: file.type },
      });
    } finally {
      setIsSavingRoom(false);
    }
  }, [isSavingRoom, session, sessionId, t, debugLog]);

  const handleProductSelect = useCallback((productId: string) => {
    if (!session) return;

    // Abort any in-flight save for a previous product; latest selection wins.
    productAbortRef.current?.abort();
    const controller = new AbortController();
    productAbortRef.current = controller;

    // Immediate local update — UI responds before the network round-trip.
    setLocalProductId(productId);
    setError(null);
    setSuccessMessage(null);
    setIsSavingProduct(true);
    setProductSaveStatus("idle");

    const t0 = Date.now();
    console.info("[room-preview] mobile_product_post_start", { sessionId, productId, t: t0 });

    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "product", productId },
    });
    debugLog("network", `POST /product  productId: ${productId}`);

    const savePromise: Promise<RoomPreviewSession | null> = saveRoomPreviewSessionProduct(
      sessionId,
      { productId },
      { signal: controller.signal },
    )
      .then((response) => {
        if (controller.signal.aborted) return null;
        setSession(response.session);
        setProductSaveStatus("success");
        console.info("[room-preview] mobile_product_response_received", {
          sessionId,
          productId: response.session.selectedProduct?.id ?? productId,
          ms: Date.now() - t0,
        });
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "product_selected",
          level: "info",
          statusAfter: response.session.status,
          metadata: { productId: response.session.selectedProduct?.id ?? productId },
        });
        debugLog("success", `Product saved  id: ${response.session.selectedProduct?.id ?? "?"}`);
        console.info("[room-preview] Product saved", {
          sessionId,
          productId: response.session.selectedProduct?.id ?? null,
          barcode:   response.session.selectedProduct?.barcode ?? null,
          status:    response.session.status,
        });
        return response.session;
      })
      .catch((saveError) => {
        // Ignore intentional aborts — a newer product selection is already in flight.
        if (controller.signal.aborted || (saveError instanceof Error && saveError.name === "AbortError")) {
          return null;
        }
        const failure = getViewStateFromError(saveError, t);
        debugLog("error", `Product save failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
        if (failure.state === "expired" || failure.state === "not_found") {
          setSession(null);
          setViewState(failure.state);
          setError(failure.message);
          debugLog("state", `viewState → ${failure.state}`);
        } else {
          console.error("[room-preview] Failed to save product", { sessionId, productId, error: saveError });
          setError(createActionErrorMessage(saveError, t.roomPreview.mobile.product.saveFailed));
          setProductSaveStatus("error");
        }
        return null;
      })
      .finally(() => {
        // Always clear the save promise — even aborted saves must not block future renders.
        if (productSavePromiseRef.current === savePromise) productSavePromiseRef.current = null;
        // Only clear saving state / abort ref if this is still the active request.
        if (!controller.signal.aborted) {
          setIsSavingProduct(false);
          if (productAbortRef.current === controller) productAbortRef.current = null;
        }
      });

    productSavePromiseRef.current = savePromise;
  }, [session, sessionId, t, debugLog]);

  // Look up a product by scanned/entered value. Tries barcode → id → name substring.
  const handleProductCodeSelect = useCallback(async (productCode: string) => {
    if (!session) return null;

    // Cancel any in-flight product-by-id save; QR scan takes priority.
    if (productAbortRef.current) {
      productAbortRef.current.abort();
      productAbortRef.current = null;
    }

    setIsSavingProduct(true);
    setProductSaveStatus("idle");
    setLocalProductId(productCode);
    setError(null);
    setSuccessMessage(null);
    setRecoveryMessage(null);

    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "product_qr_confirmed",
      level: "info",
      metadata: { productCode },
    });
    debugLog("network", `POST /product  productCode: ${productCode}`);

    try {
      const response = await saveRoomPreviewSessionProduct(sessionId, { productCode });
      setSession(response.session);
      setProductSaveStatus("success");
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "product_selected",
        level: "info",
        statusAfter: response.session.status,
        metadata: {
          productCode,
          productId: response.session.selectedProduct?.id ?? productCode,
          source: "printed_product_qr",
        },
      });
      debugLog("success", `QR product saved  id: ${response.session.selectedProduct?.id ?? "?"}`);
      return response.session;
    } catch (saveError) {
      const failure = getViewStateFromError(saveError, t);
      debugLog("error", `QR product save failed: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
      if (failure.state === "expired" || failure.state === "not_found") {
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        debugLog("state", `viewState -> ${failure.state}`);
      } else {
        console.error("[room-preview] Failed to save QR product", { sessionId, productCode, error: saveError });
        setError(createActionErrorMessage(saveError, t.roomPreview.mobile.product.saveFailed));
        setProductSaveStatus("error");
      }
      return null;
    } finally {
      setIsSavingProduct(false);
    }
  }, [session, sessionId, t, debugLog]);

  const handleCreateRender = useCallback(async (sessionOverride?: RoomPreviewSession) => {
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
        eventType: "render_request_success",
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
        setError(recovery?.text ?? t.roomPreview.mobile.loadFailed);
      }
    } catch (renderError) {
      const failure = getViewStateFromError(renderError, t);
      debugLog("error", `Render error: ${renderError instanceof Error ? renderError.message : String(renderError)}`);

      trackClientSessionEvent(renderSession.id, {
        source: "mobile",
        eventType: "render_request_failed",
        level: "error",
        code: isRoomPreviewRequestError(renderError) ? String(renderError.code) : "UNKNOWN",
        message: renderError instanceof Error ? renderError.message : String(renderError),
        metadata: {
          ...renderMetadataBase,
          status: isRoomPreviewRequestError(renderError) ? renderError.status : null,
          errorMessage: renderError instanceof Error ? renderError.message : String(renderError),
        },
      });

      if (isRoomPreviewRequestError(renderError) && renderError.code === "render_limit_reached") {
        setError("وصلت إلى عدد المحاولات المتاحة لهذه التجربة.");
        setRecoveryMessage(null);
      } else if (isRoomPreviewRequestError(renderError) && renderError.code === "render_device_cooldown") {
        setError("يمكنك طلب معاينة جديدة بعد ٥ دقائق.");
        setRecoveryMessage(null);
      } else if (isRoomPreviewRequestError(renderError) && renderError.code === "screen_budget_exhausted") {
        setError("انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص.");
        setRecoveryMessage(null);
      } else {
        const recovery = getCustomerRecoveryMessage(
          isRoomPreviewRequestError(renderError) && renderError.code === "timeout"
            ? "retry_render"
            : "reload_page",
        );
        setRecoveryMessage(recovery);
        setError(recovery?.text ?? failure.message);
      }
      trackClientSessionEvent(renderSession.id, {
        source: "mobile",
        eventType: isRoomPreviewRequestError(renderError) && renderError.code === "timeout"
          ? "render_timeout"
          : "render_failed",
        level: "error",
        code: isRoomPreviewRequestError(renderError) && renderError.code === "timeout"
          ? "RENDER_TIMEOUT"
          : "RENDER_FAILED",
        message: renderError instanceof Error ? renderError.message : String(renderError),
      });
    } finally {
      renderRequestInFlightRef.current = false;
      setIsSavingProduct(false);
    }
  }, [session, sessionId, t, debugLog]);

  const handleRetakeRoomPhoto = useCallback(() => {
    if (!session) return;
    setSession({ ...session, selectedRoom: null });
    setError(null);
    setRecoveryMessage(null);
  }, [session]);

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
