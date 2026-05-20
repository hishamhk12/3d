"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import { useMobileSession } from "@/features/room-preview/mobile/useMobileSession";
import RoomStep    from "@/features/room-preview/mobile/RoomStep";
import ProductStep from "@/features/room-preview/mobile/ProductStep";
import ResultStep  from "@/features/room-preview/mobile/ResultStep";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

type MobileSessionClientProps = {
  sessionId: string;
  products: RoomPreviewProduct[];
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

export default function MobileSessionClient({ sessionId, products }: MobileSessionClientProps) {
  useMobileBrowserLifecycle(sessionId);

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
    handleProductSelect,
    handleCreateRender,
    localProductId,
    heartbeatConnected,
  } = useMobileSession({ sessionId });

  const localSelectedProduct = useMemo(() => {
    if (!localProductId) return session?.selectedProduct ?? null;
    return products.find((p) => p.id === localProductId) ?? session?.selectedProduct ?? null;
  }, [localProductId, products, session?.selectedProduct]);

  if (viewState === "loading") {
    return (
      <div className="tour-panel w-full rounded-[32px] p-8 text-center">
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
      <SessionStatePanel
        title={t.roomPreview.mobile.notFoundTitle}
        description={error ?? t.roomPreview.mobile.notFoundDescription}
        actions={[{ href: ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession }]}
      />
    );
  }

  if (viewState === "expired") {
    return (
      <SessionStatePanel
        title={t.roomPreview.mobile.expiredTitle}
        description={error ?? t.roomPreview.mobile.expiredDescription}
        actions={[
          { href:  ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession },
          { label: t.common.actions.retry, onClick: retry, variant: "secondary" },
        ]}
      />
    );
  }

  if (viewState === "failed") {
    return (
      <SessionStatePanel
        title={t.roomPreview.mobile.failedTitle}
        description={error ?? t.roomPreview.mobile.failedDescription}
        actions={[
          { label: t.common.actions.retry,     onClick: retry },
          { href: ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession, variant: "secondary" },
        ]}
      />
    );
  }

  if (!session) {
    return (
      <SessionStatePanel
        title={t.roomPreview.mobile.failedTitle}
        description={t.roomPreview.shared.noSessionData}
        actions={[
          { label: t.common.actions.retry,     onClick: retry },
          { href: ROOM_PREVIEW_ROUTES.landing, label: t.roomPreview.shared.startNewSession, variant: "secondary" },
        ]}
      />
    );
  }

  const isRenderingSession = session.status === "ready_to_render" || session.status === "rendering";

  return (
    <div className="tour-panel w-full rounded-[32px] p-8 text-center">
      <p className="mb-6 text-xs font-semibold tracking-[0.22em] text-[var(--brand-cyan)] uppercase whitespace-nowrap">
        {t.roomPreview.shared.eyebrow}
      </p>

      {!heartbeatConnected ? (
        <div className="mb-4 rounded-[20px] border border-amber-400/40 bg-amber-50 px-5 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-300">
          يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال...
        </div>
      ) : null}

      {isConnected && !hasSavedRoom ? (
        <RoomStep
          isSavingRoom={isSavingRoom}
          roomSaveStatusLabel={roomSaveStatusLabel}
          selectedRoom={session.selectedRoom}
          onFileSelection={(source, file) => void handleFileSelection(source, file)}
        />
      ) : null}

      {hasSavedRoom ? (
        <ProductStep
          isSavingProduct={isSavingProduct}
          products={products}
          selectedProduct={localSelectedProduct}
          onProductSelect={handleProductSelect}
        />
      ) : null}

      {error ? (
        <div className="mt-6 rounded-[24px] border border-red-400/25 bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/08 dark:border-red-500/20 dark:text-red-300">
          {error}
          {recoveryMessage ? (
            <button
              type="button"
              onClick={() => {
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
                if (recoveryMessage.ctaIntent === "retry_render") { void handleCreateRender(); return; }
                if (recoveryMessage.ctaIntent === "reconnect_mobile") { retry(); return; }
                clearRecoveryMessage();
              }}
              className="mt-3 block w-full rounded-[18px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors"
            >
              {recoveryMessage.ctaText}
            </button>
          ) : null}
        </div>
      ) : null}

      {roomSaveStatus === "error"    ? <p className="mt-4 text-sm font-semibold text-red-600 dark:text-red-400">{t.roomPreview.mobile.room.saveFailed}</p>    : null}
      {productSaveStatus === "error" ? <p className="mt-4 text-sm font-semibold text-red-600 dark:text-red-400">{t.roomPreview.mobile.product.saveFailed}</p> : null}
      {successMessage ? <p className="mt-6 text-sm font-semibold text-emerald-600 dark:text-emerald-400">{successMessage}</p> : null}

      {hasSavedRoom && hasSavedProduct ? (
        <ResultStep
          session={session}
          isSavingProduct={isRenderingSession}
          showResult={showResult}
          onCreateRender={handleCreateRender}
          onModify={() => {
            void trackClientSessionEvent(sessionId, {
              source: "mobile",
              eventType: "edit_requested",
              level: "info",
              metadata: {
                currentStatus: session.status,
                productId: localProductId ?? null,
              },
            });
            setShowResult(false);
            // Re-save current product immediately so the server exits result_ready.
            // This publishes an SSE that cancels the screen's 60-second auto-reset
            // timer and hides the result overlay, giving the customer unlimited
            // time to choose a new product before pressing Render again.
            if (localProductId) {
              handleProductSelect(localProductId);
            }
          }}
        />
      ) : null}
    </div>
  );
}
