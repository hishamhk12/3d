"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { saveRoomPreviewSessionProduct } from "@/lib/room-preview/product-service";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { CustomerRecoveryMessage } from "@/lib/room-preview/customer-recovery";
import type { LogLevel } from "@/features/room-preview/mobile/debug";
import {
  createActionErrorMessage,
  getViewStateFromError,
  type MobileSessionViewState,
  type SaveStatus,
} from "@/features/room-preview/mobile/mobile-session-utils";
import { getErrorMessage } from "@/features/room-preview/mobile/mobile-session-error-utils";
import {
  getSelectedProductCount,
  getSelectedProductCodes,
  getSelectedTargetSurfaces,
  normalizeSelectedProducts,
} from "@/lib/room-preview/selected-products";

/**
 * Owns the product-selection abort guard, the `localProductId` optimistic
 * state, and both product handlers (`handleProductSelect` from the list,
 * `handleProductCodeSelect` from QR / printed code).
 *
 * Bodies moved verbatim from `useMobileSession.ts` — identical abort + race
 * semantics, identical diagnostics events, identical Arabic
 * `t.roomPreview.mobile.product.saveFailed` fallback, identical
 * `productSavePromiseRef` handoff so that `useRenderAction` can await the
 * in-flight save before submitting the render.
 *
 * Shared state that is also written by the render-poll resume effect and the
 * render action (`isSavingProduct`, `isSavingProductRef`, `setIsSavingProduct`
 * wrapper) and by 5 callers including connect / upload (`productSaveStatus`)
 * stays in the parent and is passed in via setters.
 */
export interface UseProductSelectionParams {
  session: RoomPreviewSession | null;
  setSession: Dispatch<SetStateAction<RoomPreviewSession | null>>;
  setViewState: Dispatch<SetStateAction<MobileSessionViewState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setRecoveryMessage: Dispatch<SetStateAction<CustomerRecoveryMessage | null>>;
  setProductSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  /** Wrapper from the parent that updates both the ref (sync) and the `isSavingProduct` useState. */
  setIsSavingProduct: (v: boolean) => void;
  /** Shared with the render action; handleProductSelect publishes its in-flight save here. */
  productSavePromiseRef: MutableRefObject<Promise<RoomPreviewSession | null> | null>;
  sessionId: string;
  t: TranslationDictionary;
  debugLog: (level: LogLevel, message: string, detail?: string) => void;
}

export interface UseProductSelectionReturn {
  localProductId: string | null;
  handleProductSelect: (productId: string) => void;
  handleProductCodeSelect: (productCode: string) => Promise<RoomPreviewSession | null>;
}

export function useProductSelection(
  params: UseProductSelectionParams,
): UseProductSelectionReturn {
  const {
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
  } = params;

  const [localProductId, setLocalProductId] = useState<string | null>(null);
  const productAbortRef = useRef<AbortController | null>(null);

  // ── Abort in-flight product save on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      productAbortRef.current?.abort();
    };
  }, []);

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
        const selectedProductsBeforeSave = normalizeSelectedProducts(session);
        const selectedProducts = normalizeSelectedProducts(response.session);
        const targetSurface = response.product.targetSurface ?? "floor";
        const eventType = selectedProductsBeforeSave[targetSurface]
          ? "product_replaced"
          : "product_added";
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType,
          level: "info",
          statusAfter: response.session.status,
          metadata: {
            productCode: response.product.id,
            productId: response.session.selectedProduct?.id ?? productId,
            targetSurface,
            selectedProductCount: getSelectedProductCount(selectedProducts),
            selectedProductCodes: getSelectedProductCodes(selectedProducts),
            selectedTargetSurfaces: getSelectedTargetSurfaces(selectedProducts),
          },
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
        debugLog("error", `Product save failed: ${getErrorMessage(saveError)}`);
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
  }, [
    session,
    sessionId,
    t,
    debugLog,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setProductSaveStatus,
    setIsSavingProduct,
    productSavePromiseRef,
  ]);

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
      const selectedProductsBeforeSave = normalizeSelectedProducts(session);
      const selectedProducts = normalizeSelectedProducts(response.session);
      const targetSurface = response.product.targetSurface ?? "floor";
      const eventType = selectedProductsBeforeSave[targetSurface]
        ? "product_replaced"
        : "product_added";
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType,
        level: "info",
        statusAfter: response.session.status,
        metadata: {
          productCode,
          productId: response.session.selectedProduct?.id ?? productCode,
          targetSurface,
          selectedProductCount: getSelectedProductCount(selectedProducts),
          selectedProductCodes: getSelectedProductCodes(selectedProducts),
          selectedTargetSurfaces: getSelectedTargetSurfaces(selectedProducts),
          source: "printed_product_qr",
        },
      });
      debugLog("success", `QR product saved  id: ${response.session.selectedProduct?.id ?? "?"}`);
      return response.session;
    } catch (saveError) {
      const failure = getViewStateFromError(saveError, t);
      debugLog("error", `QR product save failed: ${getErrorMessage(saveError)}`);
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
    setProductSaveStatus,
    setIsSavingProduct,
  ]);

  return { localProductId, handleProductSelect, handleProductCodeSelect };
}
