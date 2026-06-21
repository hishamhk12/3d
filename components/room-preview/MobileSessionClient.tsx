"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import RoomPreviewBackButton from "@/components/room-preview/RoomPreviewBackButton";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { abandonSession } from "@/lib/room-preview/session-client";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import { useMobileSession } from "@/features/room-preview/mobile/useMobileSession";
import RoomStep    from "@/features/room-preview/mobile/RoomStep";
import ProductStep from "@/features/room-preview/mobile/ProductStep";
import ProductQrStep from "@/features/room-preview/mobile/ProductQrStep";
import ResultStep  from "@/features/room-preview/mobile/ResultStep";
import { ROOM_PREVIEW_ACTIVE_SESSION_STORAGE_KEY } from "@/lib/room-preview/product-qr";
import type { RoomPreviewProduct, RoomPreviewSession } from "@/lib/room-preview/types";

type MobileSessionClientProps = {
  sessionId: string;
  products: RoomPreviewProduct[];
  initialProductCode?: string | null;
  showProductListFallback?: boolean;
};

function RetryAfterDelay({ delayMs, onRetry }: { delayMs: number; onRetry: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <p className="text-xs text-[var(--text-muted)]">يبدو أن الاتصال يستغرق وقتاً أطول من المعتاد</p>
      <button onClick={onRetry} className="btn-secondary px-6 py-2 text-sm">
        إعادة المحاولة
      </button>
    </div>
  );
}

/** Shown after the customer successfully triggers a new-session restart. */
function RestartedPanel() {
  return (
    <div className="mt-6 rounded-[24px] border border-emerald-400/30 bg-emerald-50 px-5 py-5 text-center dark:bg-emerald-500/08 dark:border-emerald-500/20">
      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        تم إنهاء الجلسة
      </p>
      <p className="mt-2 text-xs leading-5 text-emerald-700/70 dark:text-emerald-300/70 px-1">
        انتقل إلى الشاشة وامسح رمز QR الجديد للبدء من جديد.
      </p>
    </div>
  );
}

function useMobileBrowserLifecycle(sessionId: string) {
  useEffect(() => {
    let lastVisibility = document.visibilityState;

    function onVisibilityChange() {
      const state = document.visibilityState;
      // Deduplicate rapid duplicate fires
      if (state === lastVisibility) return;
      lastVisibility = state;

      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: state === "hidden" ? "mobile_page_hidden" : "mobile_page_visible",
        level: "info",
      });
    }

    function onPageHide() {
      const payload = JSON.stringify({
        sessionId,
        eventType: "mobile_pagehide",
        source: "mobile",
        level: "info",
        timestamp: new Date().toISOString(),
      });

      const url = `/api/room-preview/sessions/${sessionId}/diagnostics`;

      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      } else {
        // Best-effort fallback — fire-and-forget, do not block navigation
        void fetch(url, {
          method: "POST",
          body: payload,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        }).catch(() => undefined);
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sessionId]);
}

export default function MobileSessionClient({
  sessionId,
  products,
  initialProductCode = null,
  showProductListFallback = false,
}: MobileSessionClientProps) {
  useMobileBrowserLifecycle(sessionId);
  const [useProductListFallback, setUseProductListFallback] = useState(false);
  // Local loading state while the abandon API call is in flight.
  const [isAbandoning, setIsAbandoning] = useState(false);

  const {
    t,
    session,
    viewState,
    isSavingProduct,
    showResult,
    setShowResult,
    roomSaveStatusLabel,
    error,
    successMessage,
    recoveryMessage,
    clearRecoveryMessage,
    roomSaveStatus,
    productSaveStatus,
    isConnected,
    hasSavedRoom,
    hasSavedProduct,
    isSavingRoom,
    retry,
    handleFileSelection,
    retryRoomUpload,
    handleProductSelect,
    handleProductCodeSelect,
    handleCreateRender,
    handleRetakeRoomPhoto,
    localProductId,
    heartbeatConnected,
    restartDone,
    markRestartDone,
  } = useMobileSession({ sessionId });

  useEffect(() => {
    try {
      window.localStorage.setItem(ROOM_PREVIEW_ACTIVE_SESSION_STORAGE_KEY, sessionId);
    } catch {
      // Best-effort only. The in-flow scanner does not depend on localStorage.
    }
  }, [sessionId]);

  // Track when the failure recovery UI first becomes visible to the customer.
  const prevErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error && !prevErrorRef.current) {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "failure_recovery_ui_shown",
        level: "info",
        metadata: { status: session?.status ?? null },
      });
    }
    prevErrorRef.current = error;
  }, [error, session?.status, sessionId]);

  const localSelectedProduct = useMemo(() => {
    if (!localProductId) return session?.selectedProduct ?? null;
    return products.find((p) => p.id === localProductId) ?? session?.selectedProduct ?? null;
  }, [localProductId, products, session?.selectedProduct]);

  const qrProductSaveRef = useRef<{ code: string; promise: Promise<RoomPreviewSession | null> } | null>(null);

  const handleQrProductResolved = useCallback((productCode: string) => {
    console.info("[room-preview] qr_product_save_start", { sessionId, productCode, t: Date.now() });
    const savePromise = handleProductCodeSelect(productCode);
    qrProductSaveRef.current = { code: productCode, promise: savePromise };
  }, [handleProductCodeSelect, sessionId]);

  const handleGuardedBack = useCallback(() => {
    window.history.back();
  }, []);

  const handleModifyResult = useCallback(() => {
    void trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "edit_requested",
      level: "info",
      metadata: {
        currentStatus: session?.status ?? null,
        productId: localProductId ?? null,
      },
    });
    setShowResult(false);
    if (localProductId) {
      handleProductSelect(localProductId);
    }
  }, [handleProductSelect, localProductId, session?.status, sessionId, setShowResult]);

  const mobileBackButton = (
    <RoomPreviewBackButton
      ariaLabel={t.common.actions.back}
      onClick={handleGuardedBack}
      size={40}
      className="z-50"
      style={{ top: "max(16px, env(safe-area-inset-top))", left: 16 }}
    />
  );

  if (viewState === "loading") {
    return (
      <div className="relative tour-panel w-full rounded-[32px] p-8 text-center">
        {mobileBackButton}
        <p className="text-xs font-semibold tracking-[0.22em] text-[var(--brand-cyan)] uppercase whitespace-nowrap">
          {t.roomPreview.shared.eyebrow}
        </p>
        <h1 className="font-display mt-4 text-4xl font-semibold text-[var(--text-primary)]">
          {t.roomPreview.mobile.loadingTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--text-secondary)]">
          {t.roomPreview.mobile.loadingDescription}
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <LoaderCircle className="size-8 animate-spin text-[var(--brand-navy)]" />
          <p className="text-sm text-[var(--text-muted)]">{t.roomPreview.mobile.loadingLabel}</p>
        </div>
        <RetryAfterDelay delayMs={10_000} onRetry={retry} />
      </div>
    );
  }

  if (viewState === "not_found") {
    return (
      <>
        {mobileBackButton}
        <SessionStatePanel
          title={t.roomPreview.mobile.notFoundTitle}
          description={error ?? t.roomPreview.mobile.notFoundDescription}
          actions={[{ href: ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession }]}
        />
      </>
    );
  }

  // When the session expires (naturally or from abandon), if the customer has
  // already been shown the restart instruction keep showing it — the
  // SessionStatePanel would be confusing at this point.
  if (viewState === "expired") {
    if (restartDone) {
      return (
        <div className="relative tour-panel w-full rounded-[32px] p-8 text-center">
          {mobileBackButton}
          <p className="mb-6 text-xs font-semibold tracking-[0.22em] text-[var(--brand-cyan)] uppercase whitespace-nowrap">
            {t.roomPreview.shared.eyebrow}
          </p>
          <RestartedPanel />
        </div>
      );
    }
    return (
      <>
        {mobileBackButton}
        <SessionStatePanel
          title={t.roomPreview.mobile.expiredTitle}
          description={error ?? t.roomPreview.mobile.expiredDescription}
          actions={[
            { href:  ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession },
            { label: t.common.actions.retry, onClick: retry, variant: "secondary" },
          ]}
        />
      </>
    );
  }

  if (viewState === "failed") {
    return (
      <>
        {mobileBackButton}
        <SessionStatePanel
          title={t.roomPreview.mobile.failedTitle}
          description={error ?? t.roomPreview.mobile.failedDescription}
          actions={[
            { label: t.common.actions.retry,     onClick: retry },
            { href: ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession, variant: "secondary" },
          ]}
        />
      </>
    );
  }

  if (!session) {
    return (
      <>
        {mobileBackButton}
        <SessionStatePanel
          title={t.roomPreview.mobile.failedTitle}
          description={t.roomPreview.shared.noSessionData}
          actions={[
            { label: t.common.actions.retry,     onClick: retry },
            { href: ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession, variant: "secondary" },
          ]}
        />
      </>
    );
  }

  const isRenderingSession = session.status === "ready_to_render" || session.status === "rendering";
  const shouldUseProductList = useProductListFallback;
  const shouldShowProductQrStep =
    hasSavedRoom &&
    !shouldUseProductList &&
    !isRenderingSession &&
    !showResult &&
    session.status !== "result_ready" &&
    session.status !== "failed";
  const shouldShowLegacyProductStep = hasSavedRoom && shouldUseProductList;
  const shouldShowResultStep =
    hasSavedRoom &&
    hasSavedProduct &&
    (shouldUseProductList || isRenderingSession || showResult ||
     session.status === "result_ready" ||
     session.status === "failed");
  const initialQrProductCode =
    initialProductCode ??
    (!shouldUseProductList && session.selectedProduct?.imageUrl?.startsWith("/qr-products/")
      ? session.selectedProduct.id
      : null);

  const handleQrGenerate = async (productCode: string) => {
    let selectedSession: RoomPreviewSession | null = null;
    if (qrProductSaveRef.current?.code === productCode) {
      console.info("[room-preview] qr_product_awaiting_save", { sessionId, productCode, t: Date.now() });
      selectedSession = await qrProductSaveRef.current.promise;
      qrProductSaveRef.current = null;
    } else {
      selectedSession = await handleProductCodeSelect(productCode);
    }
    if (!selectedSession) return;
    await handleCreateRender(selectedSession);
  };

  // The room-upload step is rendered as the page itself: a route-contained
  // white surface (no card, no eyebrow, no outer background).
  // Every other step keeps the existing glass card + eyebrow unchanged.
  const isRoomUploadStep = isConnected && !hasSavedRoom;
  const isWhiteMobileStep = isRoomUploadStep || shouldShowProductQrStep;
  const isRoomUploadError = isRoomUploadStep && roomSaveStatus === "error";

  return (
    <div
      className={
        isWhiteMobileStep
          ? "relative mx-[calc(50%-50vw)] my-[-2.5rem] flex min-h-[100svh] w-screen flex-col bg-white px-6 text-[var(--text-primary)]"
          : "relative tour-panel w-full rounded-[32px] p-8 text-center"
      }
      style={
        isWhiteMobileStep
          ? {
              paddingTop: "max(1rem, env(safe-area-inset-top))",
              paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            }
          : undefined
      }
    >
      {!shouldShowResultStep ? (
        <RoomPreviewBackButton
          ariaLabel={t.common.actions.back}
          onClick={hasSavedRoom ? handleRetakeRoomPhoto : handleGuardedBack}
          size={40}
          className="z-50"
          style={{ top: "max(16px, env(safe-area-inset-top))", left: 16 }}
        />
      ) : null}
      {!isWhiteMobileStep ? (
        <p className="mb-6 text-xs font-semibold tracking-[0.22em] text-[var(--brand-cyan)] uppercase whitespace-nowrap">
          {t.roomPreview.shared.eyebrow}
        </p>
      ) : null}

      {!heartbeatConnected ? (
        <div className="mb-4 rounded-[20px] border border-amber-400/40 bg-amber-50 px-5 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-300">
          يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال...
        </div>
      ) : null}

      {isConnected && !hasSavedRoom ? (
        <RoomStep
          isSavingRoom={isSavingRoom}
          roomSaveStatus={roomSaveStatus}
          roomSaveStatusLabel={roomSaveStatusLabel}
          uploadError={error}
          selectedRoom={session.selectedRoom}
          onFileSelection={(source, file) => void handleFileSelection(source, file)}
          onRetryUpload={retryRoomUpload}
        />
      ) : null}

      {shouldShowLegacyProductStep ? (
        <ProductStep
          isSavingProduct={isSavingProduct}
          products={products}
          selectedProduct={localSelectedProduct}
          onProductSelect={handleProductSelect}
        />
      ) : null}

      {shouldShowProductQrStep ? (
        <ProductQrStep
          initialProductCode={initialQrProductCode}
          isBusy={isSavingProduct || isRenderingSession}
          canUseProductListFallback={showProductListFallback}
          onUseProductListFallback={() => setUseProductListFallback(true)}
          onProductResolved={handleQrProductResolved}
          onGenerateWithProductCode={handleQrGenerate}
        />
      ) : null}

      {/* Restart-done banner: replaces the error block once the customer has
          requested a new session. No retry or render buttons are shown. */}
      {restartDone ? (
        <RestartedPanel />
      ) : error && !isRoomUploadError ? (
        <div className="mt-6 rounded-[24px] border border-red-400/25 bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/08 dark:border-red-500/20 dark:text-red-300">
          {error}
          <div className="mt-3 flex flex-col gap-2">
            {/* Primary action — إعادة المحاولة */}
            {recoveryMessage ? (
              <button
                type="button"
                onClick={() => {
                  trackClientSessionEvent(sessionId, {
                    source: "mobile",
                    eventType: "recovery_retry_clicked",
                    level: "info",
                    metadata: { ctaIntent: recoveryMessage.ctaIntent, status: session.status },
                  });
                  if (recoveryMessage.ctaIntent === "reload_page") {
                    trackClientSessionEvent(sessionId, {
                      source: "mobile",
                      eventType: "mobile_reload_blocked",
                      level: "warning",
                      message: "Blocked mobile hard reload and retried inside the current page.",
                      metadata: { status: session.status },
                    });
                    clearRecoveryMessage();
                    retry();
                    return;
                  }
                  if (recoveryMessage.ctaIntent === "retry_render") {
                    trackClientSessionEvent(sessionId, {
                      source: "mobile",
                      eventType: "render_retry_clicked",
                      level: "info",
                      metadata: { status: session.status },
                    });
                    void handleCreateRender();
                    return;
                  }
                  if (recoveryMessage.ctaIntent === "reconnect_mobile") { retry(); return; }
                  if (recoveryMessage.ctaIntent === "retake_room_photo") { handleRetakeRoomPhoto(); return; }
                  clearRecoveryMessage();
                }}
                disabled={
                  recoveryMessage.ctaIntent === "retry_render" &&
                  session.status !== "failed" &&
                  session.status !== "product_selected" &&
                  session.status !== "result_ready"
                }
                className="block w-full rounded-[18px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {recoveryMessage.ctaText}
              </button>
            ) : null}

            {/* Secondary action — تجربة مرة أخرى */}
            <button
              type="button"
              disabled={isAbandoning}
              onClick={() => {
                trackClientSessionEvent(sessionId, {
                  source: "mobile",
                  eventType: "recovery_restart_clicked",
                  level: "info",
                  metadata: { status: session.status, hasRecoveryMessage: recoveryMessage !== null },
                });
                trackClientSessionEvent(sessionId, {
                  source: "mobile",
                  eventType: "new_session_requested_after_failure",
                  level: "info",
                  metadata: { status: session.status },
                });
                setIsAbandoning(true);
                void abandonSession(sessionId)
                  .catch(() => undefined)
                  .finally(() => {
                    setIsAbandoning(false);
                    markRestartDone();
                    trackClientSessionEvent(sessionId, {
                      source: "mobile",
                      eventType: "recovery_restart_completed",
                      level: "info",
                      metadata: { status: session.status },
                    });
                  });
              }}
              className="block w-full rounded-[18px] border border-[var(--border-subtle,var(--border-strong))] bg-transparent px-4 py-2.5 text-center text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAbandoning ? "..." : "تجربة مرة أخرى"}
            </button>
          </div>
        </div>
      ) : null}

      {roomSaveStatus === "error" && !isRoomUploadError ? <p className="mt-4 text-sm font-semibold text-red-600 dark:text-red-400">{t.roomPreview.mobile.room.saveFailed}</p> : null}
      {productSaveStatus === "error" ? <p className="mt-4 text-sm font-semibold text-red-600 dark:text-red-400">{t.roomPreview.mobile.product.saveFailed}</p> : null}
      {successMessage ? <p className="mt-6 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{successMessage}</p> : null}

      {shouldShowResultStep ? (
        <ResultStep
          session={session}
          isSavingProduct={isRenderingSession}
          showResult={showResult}
          onCreateRender={handleCreateRender}
          onBack={handleRetakeRoomPhoto}
          onProcessingBack={handleGuardedBack}
          hasRenderError={error !== null || restartDone}
          onModify={handleModifyResult}
        />
      ) : null}
    </div>
  );
}
