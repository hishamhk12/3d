"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { useMobileSession } from "@/features/room-preview/mobile/useMobileSession";
import RoomStep    from "@/features/room-preview/mobile/RoomStep";
import ProductStep from "@/features/room-preview/mobile/ProductStep";
import ResultStep  from "@/features/room-preview/mobile/ResultStep";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileSessionClientProps = {
  sessionId: string;
  products: RoomPreviewProduct[];
};

// ─── RetryAfterDelay ──────────────────────────────────────────────────────────

function RetryAfterDelay({ delayMs, onRetry }: { delayMs: number; onRetry: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <p className="text-xs text-[#8b7b8a]">يبدو أن الاتصال يستغرق وقتاً أطول من المعتاد</p>
      <button onClick={onRetry} className="glass-button px-6 py-2 text-sm font-semibold">
        إعادة المحاولة
      </button>
    </div>
  );
}

// ─── MobileSessionClient ──────────────────────────────────────────────────────

export default function MobileSessionClient({
  sessionId,
  products,
}: MobileSessionClientProps) {
  const {
    t,
    session,
    viewState,
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
    isSavingRoom,
    retry,
    handleFileSelection,
    handleCameraBarcode,
    handleCodeSubmit,
    handleProductSelect,
    handleCreateRender,
  } = useMobileSession({ sessionId, products });

  if (viewState === "loading") {
    return (
      <>
        <div className="tour-panel w-full rounded-[32px] p-8 text-center">
          <p className="text-xs font-semibold tracking-[0.22em] text-[#003C71] uppercase whitespace-nowrap" style={{ textShadow: "0 1px 2px rgba(255,255,255,0.8)" }}>
            {t.roomPreview.shared.eyebrow}
          </p>
          <h1 className="font-display mt-4 text-4xl font-semibold text-[#1d1d1f]">
            {t.roomPreview.mobile.loadingTitle}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#4a4a52]">
            {t.roomPreview.mobile.loadingDescription}
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <LoaderCircle className="size-8 animate-spin" style={{ color: "#003C71" }} />
            <p className="text-sm text-[#4a4a52]">{t.roomPreview.mobile.loadingLabel}</p>
          </div>
          <RetryAfterDelay delayMs={10_000} onRetry={retry} />
        </div>
      </>
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
          { label: t.common.actions.retry,      onClick: retry },
          { href:  ROOM_PREVIEW_ROUTES.landing,  label: t.roomPreview.shared.startNewSession, variant: "secondary" },
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
          { label: t.common.actions.retry,      onClick: retry },
          { href:  ROOM_PREVIEW_ROUTES.landing,  label: t.roomPreview.shared.startNewSession, variant: "secondary" },
        ]}
      />
    );
  }

  return (
    <>
      <div className="tour-panel w-full rounded-[32px] p-8 text-center">
        <p className="mb-6 text-xs font-semibold tracking-[0.22em] text-[#003C71] uppercase whitespace-nowrap" style={{ textShadow: "0 1px 2px rgba(255,255,255,0.8)" }}>
          {t.roomPreview.shared.eyebrow}
        </p>

        {isConnected ? (
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
            isScanning={isScanning}
            products={products}
            selectedProduct={session.selectedProduct}
            productCodeInput={productCodeInput}
            onProductCodeInputChange={setProductCodeInput}
            onBarcodeScanned={(v) => void handleCameraBarcode(v)}
            onCodeSubmit={() => void handleCodeSubmit()}
            onProductSelect={(id) => void handleProductSelect(id)}
          />
        ) : null}

        {error ? (
          <div className="mt-6 rounded-[24px] border border-rose-400/30 bg-[rgba(155,50,89,0.08)] px-5 py-4 text-sm text-[#7a1a3a]">
            {error}
          </div>
        ) : null}

        {roomSaveStatus === "error"      ? <p className="mt-4 text-sm font-semibold text-[#8a1a2a]">{t.roomPreview.mobile.room.saveFailed}</p>    : null}
        {roomSaveStatus === "success"    ? <p className="mt-4 text-sm font-semibold text-[#1a7a3a]">{t.roomPreview.mobile.room.saveSuccess}</p>   : null}
        {productSaveStatus === "error"   ? <p className="mt-4 text-sm font-semibold text-[#8a1a2a]">{t.roomPreview.mobile.product.saveFailed}</p>  : null}
        {productSaveStatus === "success" ? <p className="mt-4 text-sm font-semibold text-[#1a7a3a]">{t.roomPreview.mobile.product.saveSuccess}</p> : null}
        {successMessage ? <p className="mt-6 text-sm font-semibold text-[#1a7a3a]">{successMessage}</p> : null}

        {hasSavedRoom && hasSavedProduct ? (
          <ResultStep
            session={session}
            isSavingProduct={isSavingProduct}
            isScanning={isScanning}
            showResult={showResult}
            onCreateRender={() => void handleCreateRender()}
            onModify={() => setShowResult(false)}
          />
        ) : null}
      </div>
    </>
  );
}
