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
import { saveRoomPreviewSessionRoom } from "@/lib/room-preview/room-service";
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
  }, [session?.status, updateStatus]);

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
      debugLog("network", `GET ${url}`, `attempt #${loadAttempt + 1}`);
      trackFetch(); // timestamps this fetch; emits MOBILE_EXCESSIVE_POLLING if burst detected

      try {
        const nextSession = await fetchRoomPreviewSession(sessionId);

        if (!active) return;

        let finalSession = nextSession;

        // Auto-connect here to skip the manual "I am connected" button on mobile
        if (!isSessionConnected(nextSession)) {
          debugLog("network", `Auto-connecting session: ${sessionId}`);
          try {
            finalSession = await connectRoomPreviewSession(sessionId);
            debugLog("success", "Auto-connected successfully");
          } catch (autoConnectError) {
            debugLog("error", `Failed to auto-connect session: ${autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError)}`);
            trackClientSessionEvent(sessionId, {
              source: "mobile",
              eventType: "mobile_auto_connect_failed",
              level: "error",
              message: autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError),
              metadata: { attempt: loadAttempt + 1 },
            });
            throw autoConnectError;
          }
        }

        debugLog("success", `Session loaded — status: ${finalSession.status}`);
        debugLog("state",   `viewState → ready`);
        setSession(finalSession);
        setViewState("ready");
      } catch (loadError) {
        if (!active) return;

        const isTypeFailed =
          loadError instanceof TypeError && loadError.message === "Failed to fetch";

        debugLog(
          "error",
          isTypeFailed
            ? "TypeError: Failed to fetch (firewall / wrong network?)"
            : `Fetch error: ${loadError instanceof Error ? loadError.message : String(loadError)}`,
          loadError instanceof Error
            ? `code: ${isRoomPreviewRequestError(loadError) ? loadError.code : "n/a"}`
            : undefined,
        );

        const failure = getViewStateFromError(loadError, t);
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "mobile_fetch_failed",
          level: "error",
          code: isRoomPreviewRequestError(loadError) && loadError.code === "network"
            ? "NETWORK_INTERRUPTED"
            : null,
          message: loadError instanceof Error ? loadError.message : String(loadError),
          metadata: { attempt: loadAttempt + 1 },
        });
        debugLog("state", `viewState → ${failure.state}`);
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
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

    try {
      await connectRoomPreviewSession(sessionId);
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
    setRoomSaveStatusLabel(t.roomPreview.mobile.room.uploadStatus);

    const fileToUpload = await compressRoomImage(file);

    debugLog(
      "network",
      `POST /room  source: ${source}`,
      `file: ${file.name} (${file.size}b)  ${fileToUpload !== file ? `compressed → ${fileToUpload.name} (${fileToUpload.size}b, ${Math.round((1 - fileToUpload.size / file.size) * 100)}% smaller)` : "skipped compression (file already small)"}`,
    );

    try {
      const response = await saveRoomPreviewSessionRoom(
        sessionId,
        { source, file: fileToUpload, previousRoomImageUrl: session.selectedRoom?.imageUrl },
      );

      setSession(response.session);
      setRoomSaveStatus("success");
      setRoomSaveStatusLabel(null);
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "room_upload_completed",
        level: "info",
        statusAfter: response.session.status,
        metadata: { source },
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
        setError(recovery?.text ?? createActionErrorMessage(saveError, t.roomPreview.mobile.room.saveFailed));
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
    if (
      renderRequestInFlightRef.current ||
      isSavingProduct ||
      !session ||
      session.status === "ready_to_render" ||
      session.status === "rendering"
    ) {
      debugLog("warn", "Ignored duplicate render request");
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

    try {
      // Returns immediately (202) with session in ready_to_render state.
      const renderingSession = await createRenderForSession(session.id);
      setSession(renderingSession);
      debugLog("success", "Render started — polling for result");

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
