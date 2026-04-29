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
  handleCreateRender: () => Promise<void>;

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
  const [isSavingProduct,     setIsSavingProduct]    = useState(false);
  const [localProductId,      setLocalProductId]     = useState<string | null>(null);
  const productDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showResult,          setShowResult]         = useState(false);
  const [roomSaveStatusLabel, setRoomSaveStatusLabel]= useState<string | null>(null);
  const [error,               setError]              = useState<string | null>(null);
  const [successMessage,      setSuccessMessage]     = useState<string | null>(null);
  const [roomSaveStatus,      setRoomSaveStatus]     = useState<SaveStatus>("idle");
  const [productSaveStatus,   setProductSaveStatus]  = useState<SaveStatus>("idle");
  const [recoveryMessage,     setRecoveryMessage]    = useState<CustomerRecoveryMessage | null>(null);
  const renderRequestInFlightRef = useRef(false);

  const { entries: debugEntries, add: debugLog, clear: clearDebugLog } = useDebugLog();
  const { trackFetch, updateStatus } = useMobileDiagnostics(sessionId);

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

  // ── Debounce cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (productDebounceRef.current) clearTimeout(productDebounceRef.current);
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
          ? getCustomerRecoveryMessage("retake_room_photo")
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

    // Immediate local update — UI responds instantly, no spinner yet
    setLocalProductId(productId);
    setError(null);
    setSuccessMessage(null);

    // Cancel any pending save from previous navigation
    if (productDebounceRef.current) clearTimeout(productDebounceRef.current);

    // Save to server 700ms after the user stops navigating
    productDebounceRef.current = setTimeout(() => {
      setIsSavingProduct(true);
      setProductSaveStatus("idle");

      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_tap_detected",
        level: "info",
        metadata: { target: "product", productId },
      });
      debugLog("network", `POST /product  productId: ${productId}`);

      saveRoomPreviewSessionProduct(sessionId, { productId })
        .then((response) => {
          setSession(response.session);
          setProductSaveStatus("success");
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
        })
        .catch((saveError) => {
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
        })
        .finally(() => {
          setIsSavingProduct(false);
        });
    }, 700);
  }, [session, sessionId, t, debugLog]);

  // Look up a product by scanned/entered value. Tries barcode → id → name substring.
  const handleCreateRender = useCallback(async () => {
    console.log("[render] handler called", {
      productDebounce: productDebounceRef.current,
      inFlight: renderRequestInFlightRef.current,
      isSavingProduct,
      sessionStatus: session?.status ?? null,
      sessionId,
    });

    if (productDebounceRef.current !== null) {
      console.log("[render] blocked — product debounce pending", { timer: productDebounceRef.current });
      debugLog("warn", "Render blocked — product save debounce still pending");
      trackClientSessionEvent(session?.id ?? sessionId, {
        source: "mobile",
        eventType: "render_request_failed",
        level: "warning",
        code: "BLOCKED_PENDING_PRODUCT_DEBOUNCE",
        message: "Render blocked — product save debounce still pending",
        metadata: {
          sessionId: session?.id ?? sessionId,
          currentStatus: session?.status ?? null,
          hasRoomImage: Boolean(session?.selectedRoom?.imageUrl),
          hasProduct: Boolean(session?.selectedProduct?.id && session?.selectedProduct?.imageUrl),
          productId: session?.selectedProduct?.id ?? null,
          endpoint: `/api/room-preview/sessions/${session?.id ?? sessionId}/render`,
          blockedBy: "product_debounce",
          debounceTimer: String(productDebounceRef.current),
        },
      });
      trackClientSessionEvent(session?.id ?? sessionId, {
        source: "mobile",
        eventType: "mobile_tap_detected",
        level: "warning",
        metadata: { target: "render", blocked: "pending_product_debounce" },
      });
      return;
    }

    if (
      renderRequestInFlightRef.current ||
      isSavingProduct ||
      !session ||
      session.status === "ready_to_render" ||
      session.status === "rendering"
    ) {
      const blockedBy = renderRequestInFlightRef.current
        ? "in_flight"
        : isSavingProduct
          ? "is_saving_product"
          : !session
            ? "no_session"
            : "already_rendering";
      console.log("[render] early return", { blockedBy, status: session?.status });
      debugLog("warn", `Ignored duplicate render request (blockedBy: ${blockedBy})`);
      return;
    }

    renderRequestInFlightRef.current = true;

    trackClientSessionEvent(session.id, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "render" },
    });
    setIsSavingProduct(true);
    setError(null);
    setSuccessMessage(null);
    setRecoveryMessage(null);
    debugLog("network", `POST /render  sessionId: ${session.id}`);

    const renderMetadataBase = {
      sessionId: session.id,
      currentStatus: session.status,
      hasRoomImage: Boolean(session.selectedRoom?.imageUrl),
      hasProduct: Boolean(session.selectedProduct?.id && session.selectedProduct?.imageUrl),
      productId: session.selectedProduct?.id ?? null,
      endpoint: `/api/room-preview/sessions/${session.id}/render`,
    };

    console.log("[render] request started", renderMetadataBase);
    trackClientSessionEvent(session.id, {
      source: "mobile",
      eventType: "render_request_started",
      level: "info",
      metadata: renderMetadataBase,
    });

    try {
      // Returns immediately (202) with session in ready_to_render state.
      const renderingSession = await createRenderForSession(session.id);
      setSession(renderingSession);
      debugLog("success", "Render started — polling for result");

      trackClientSessionEvent(session.id, {
        source: "mobile",
        eventType: "render_request_success",
        level: "info",
        metadata: { ...renderMetadataBase, statusAfter: renderingSession.status },
      });

      // Poll until the server pushes result_ready or failed via DB.
      const finalSession = await pollForRenderResult(session.id, undefined, {
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

      trackClientSessionEvent(session.id, {
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

      const recovery = getCustomerRecoveryMessage(
        isRoomPreviewRequestError(renderError) && renderError.code === "timeout"
          ? "retry_render"
          : "reload_page",
      );
      setRecoveryMessage(recovery);
      setError(recovery?.text ?? failure.message);
      trackClientSessionEvent(session.id, {
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
  }, [isSavingProduct, session, t, debugLog]);

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
    handleCreateRender,
    debugEntries,
    clearDebugLog,
  };
}
