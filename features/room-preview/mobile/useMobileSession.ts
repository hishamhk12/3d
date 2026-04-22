"use client";

import { useCallback, useEffect, useState } from "react";
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
import { useDebugLog } from "@/features/room-preview/mobile/debug";
import type { LogEntry } from "@/features/room-preview/mobile/debug";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type {
  RoomPreviewProduct,
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
  isScanning: boolean;
  productCodeInput: string;
  setProductCodeInput: (v: string) => void;
  showResult: boolean;
  setShowResult: (v: boolean) => void;
  roomSaveStatusLabel: string | null;
  error: string | null;
  successMessage: string | null;
  roomSaveStatus: SaveStatus;
  productSaveStatus: SaveStatus;

  // Derived
  isConnected: boolean;
  hasSavedRoom: boolean;
  hasSavedProduct: boolean;
  sectionAlignClass: string;
  fileInputSpacingClass: string;
  inlineSpinnerSpacingClass: string;

  // Actions
  retry: () => void;
  handleConnect: () => Promise<void>;
  handleFileSelection: (source: Extract<RoomPreviewRoomSource, "camera" | "gallery">, file: File | null) => Promise<void>;
  handleCameraBarcode: (rawValue: string) => Promise<void>;
  handleCodeSubmit: () => Promise<void>;
  handleProductSelect: (productId: string) => Promise<void>;
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
  products,
}: {
  sessionId: string;
  products: RoomPreviewProduct[];
}): UseMobileSessionReturn {
  const { dir, formatMessage, locale, t } = useI18n();

  const [session,             setSession]            = useState<RoomPreviewSession | null>(null);
  const [viewState,           setViewState]          = useState<MobileSessionViewState>("loading");
  const [loadAttempt,         setLoadAttempt]        = useState(0);
  const [isConnecting,        setIsConnecting]       = useState(false);
  const [isSavingRoom,        setIsSavingRoom]       = useState(false);
  const [isSavingProduct,     setIsSavingProduct]    = useState(false);
  const [isScanning,          setIsScanning]         = useState(false);
  const [productCodeInput,    setProductCodeInput]   = useState("");
  const [showResult,          setShowResult]         = useState(false);
  const [roomSaveStatusLabel, setRoomSaveStatusLabel]= useState<string | null>(null);
  const [error,               setError]              = useState<string | null>(null);
  const [successMessage,      setSuccessMessage]     = useState<string | null>(null);
  const [roomSaveStatus,      setRoomSaveStatus]     = useState<SaveStatus>("idle");
  const [productSaveStatus,   setProductSaveStatus]  = useState<SaveStatus>("idle");

  const { entries: debugEntries, add: debugLog, clear: clearDebugLog } = useDebugLog();

  // ── Lifecycle logging ────────────────────────────────────────────────────────
  useEffect(() => {
    debugLog("info", "MobileSessionClient mounted", `sessionId: ${sessionId}`);
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

      const url = `/api/room-preview/sessions/${sessionId}`;
      debugLog("network", `GET ${url}`, `attempt #${loadAttempt + 1}`);

      try {
        const nextSession = await fetchRoomPreviewSession(sessionId);

        if (!active) return;

        let finalSession = nextSession;

        // Auto-connect here to skip the manual "I am connected" button on mobile
        if (!isSessionConnected(nextSession)) {
          debugLog("network", `Auto-connecting session: ${sessionId}`);
          try {
            await connectRoomPreviewSession(sessionId);
            finalSession = {
              ...nextSession,
              mobileConnected: true,
              status: nextSession.selectedProduct?.id && nextSession.selectedProduct?.imageUrl
                ? "product_selected"
                : nextSession.selectedRoom?.imageUrl
                  ? "room_selected"
                  : "mobile_connected",
            };
            debugLog("success", "Auto-connected successfully");
          } catch (autoConnectError) {
             debugLog("error", `Failed to auto-connect session: ${autoConnectError instanceof Error ? autoConnectError.message : String(autoConnectError)}`);
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
        debugLog("state", `viewState → ${failure.state}`);
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
      }
    }

    void loadSession();
    return () => { active = false; };
  }, [loadAttempt, sessionId, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    if (isConnecting || !session || isSessionConnected(session)) return;

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

    setIsSavingRoom(true);
    setError(null);
    setSuccessMessage(null);
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
        setError(createActionErrorMessage(saveError, t.roomPreview.mobile.room.saveFailed));
        setRoomSaveStatus("error");
        setRoomSaveStatusLabel(null);
      }
    } finally {
      setIsSavingRoom(false);
    }
  }, [isSavingRoom, session, sessionId, t, debugLog]);

  const handleProductSelect = useCallback(async (productId: string) => {
    if (isSavingProduct || !session) return;

    setIsSavingProduct(true);
    setError(null);
    setSuccessMessage(null);
    setProductSaveStatus("idle");

    debugLog("network", `POST /product  productId: ${productId}`);

    try {
      const response = await saveRoomPreviewSessionProduct(sessionId, { productId });
      setSession(response.session);
      setProductSaveStatus("success");
      debugLog("success", `Product saved  id: ${response.session.selectedProduct?.id ?? "?"}`);
      console.info("[room-preview] Product saved", {
        sessionId,
        productId: response.session.selectedProduct?.id ?? null,
        barcode:   response.session.selectedProduct?.barcode ?? null,
        status:    response.session.status,
      });
    } catch (saveError) {
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
    } finally {
      setIsSavingProduct(false);
    }
  }, [isSavingProduct, session, sessionId, t, debugLog]);

  // Look up a product by scanned/entered value. Tries barcode → id → name substring.
  const lookupProduct = useCallback((code: string) => {
    const q = code.trim();
    if (!q) return null;
    const ql = q.toLowerCase();
    return products.find(
      (p) => (p.barcode && p.barcode === q) || p.id === q || p.name.toLowerCase().includes(ql),
    ) ?? null;
  }, [products]);

  // Called by ProductStep when the BarcodeDetector API decodes a barcode from the camera.
  const handleCameraBarcode = useCallback(async (rawValue: string) => {
    if (isSavingProduct || isScanning || !session) return;

    setIsScanning(true);
    setError(null);
    setSuccessMessage(null);
    setProductSaveStatus("idle");
    debugLog("info", `Camera barcode detected: "${rawValue}"`);

    try {
      const found = lookupProduct(rawValue);
      if (!found) {
        setError(t.roomPreview.mobile.product.productNotFound);
        return;
      }
      await handleProductSelect(found.id);
    } finally {
      setIsScanning(false);
    }
  }, [isSavingProduct, isScanning, session, lookupProduct, t, handleProductSelect, debugLog]);

  // Called when the user submits a manually entered product code.
  const handleCodeSubmit = useCallback(async () => {
    const code = productCodeInput.trim();
    if (!code || isSavingProduct || isScanning || !session) return;

    setIsScanning(true);
    setError(null);
    setSuccessMessage(null);
    setProductSaveStatus("idle");
    debugLog("info", `Code submitted: "${code}"`);

    try {
      const found = lookupProduct(code);
      if (!found) {
        setError(t.roomPreview.mobile.product.productNotFound);
        return;
      }
      await handleProductSelect(found.id);
      setProductCodeInput("");
    } finally {
      setIsScanning(false);
    }
  }, [productCodeInput, isSavingProduct, isScanning, session, lookupProduct, t, handleProductSelect, debugLog]);

  const handleCreateRender = useCallback(async () => {
    if (isSavingProduct || !session) return;

    setIsSavingProduct(true);
    setError(null);
    setSuccessMessage(null);
    debugLog("network", `POST /render  sessionId: ${session.id}`);

    try {
      // Returns immediately (202) with session in ready_to_render state.
      const renderingSession = await createRenderForSession(session.id);
      setSession(renderingSession);
      debugLog("success", "Render started — polling for result");

      // Poll until the server pushes result_ready or failed via DB.
      const finalSession = await pollForRenderResult(session.id);
      setSession(finalSession);

      if (finalSession.status === "result_ready") {
        setShowResult(true);
        setSuccessMessage(t.roomPreview.mobile.product.saveSuccess);
        debugLog("success", "Render complete");
      } else {
        debugLog("error", "Render pipeline failed — session marked failed");
        setError(t.roomPreview.mobile.loadFailed);
      }
    } catch (renderError) {
      const failure = getViewStateFromError(renderError, t);
      debugLog("error", `Render error: ${renderError instanceof Error ? renderError.message : String(renderError)}`);
      setError(failure.message);
    } finally {
      setIsSavingProduct(false);
    }
  }, [isSavingProduct, session, t, debugLog]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const isConnected    = session ? isSessionConnected(session) : false;
  const hasSavedRoom   = Boolean(session?.selectedRoom?.imageUrl);
  const hasSavedProduct = Boolean(
    session?.selectedProduct?.id && session?.selectedProduct?.imageUrl,
  );

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
    isScanning,
    productCodeInput,
    setProductCodeInput,
    showResult,
    setShowResult,
    roomSaveStatusLabel,
    error,
    successMessage,
    roomSaveStatus,
    productSaveStatus,
    isConnected,
    hasSavedRoom,
    hasSavedProduct,
    sectionAlignClass,
    fileInputSpacingClass,
    inlineSpinnerSpacingClass,
    retry: () => setLoadAttempt((n) => n + 1),
    handleConnect,
    handleFileSelection,
    handleCameraBarcode,
    handleCodeSubmit,
    handleProductSelect,
    handleCreateRender,
    debugEntries,
    clearDebugLog,
  };
}
