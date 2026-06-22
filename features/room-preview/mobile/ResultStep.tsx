"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ZoomIn, X } from "lucide-react";
import { ImageComparison } from "@/components/image-comparison-slider";
import DownloadHoverButton from "@/components/ui/download-hover-button";
import RoomPreviewBackButton from "@/components/room-preview/RoomPreviewBackButton";
import { useI18n } from "@/lib/i18n/provider";
import { RenderLoadingAnimation } from "@/features/room-preview/shared/RenderLoadingAnimation";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ── Main component ─────────────────────────────────────────────────────────────

interface ResultStepProps {
  session: RoomPreviewSession;
  isSavingProduct: boolean;
  showResult: boolean;
  onCreateRender: () => Promise<void>;
  onModify: () => void;
  onBack: () => void;
  onProcessingBack: () => void;
  /** When true the idle render button is hidden — the parent's two-button recovery UI handles retry. */
  hasRenderError?: boolean;
}

export default function ResultStep({
  session,
  isSavingProduct,
  showResult,
  onCreateRender,
  onBack,
  onProcessingBack,
  hasRenderError = false,
}: ResultStepProps) {
  const { locale, t } = useI18n();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [btnState, setBtnState] = useState<"idle" | "loading">("idle");
  const [localShowResult, setLocalShowResult] = useState(showResult);
  const renderClickLockedRef = useRef(false);

  useEffect(() => {
    if (showResult) {
      const timer = setTimeout(() => setLocalShowResult(true), 1500);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setBtnState("idle");
      setLocalShowResult(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [showResult]);

  useEffect(() => {
    if (!localShowResult && !isFullscreen) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [localShowResult, isFullscreen]);

  // Real session images: before = uploaded room, after = generated render.
  // Keep the existing fallback so the slider never receives an undefined URL.
  const afterImageUrl = session.renderResult?.imageUrl ?? "/rs/rs.png";
  const beforeImageUrl = session.selectedRoom?.imageUrl ?? afterImageUrl;

  const showLoadingScreen = (isSavingProduct || showResult) && !localShowResult;
  // Hide the idle CTA when the parent is displaying its own two-button failure recovery UI,
  // so the customer never sees duplicate "retry render" triggers at the same time.
  const showIdleButton = !localShowResult && !isSavingProduct && !showResult && !hasRenderError;

  const fullscreenLightbox = isFullscreen ? (
    <div
      className="fullscreen-fade-in fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden bg-black/90 p-3"
      onClick={() => setIsFullscreen(false)}
    >
      <button
        type="button"
        className="absolute top-6 right-6 sm:top-8 sm:right-8 z-[1010] text-white/60 hover:text-white bg-white/08 hover:bg-white/14 transition-all backdrop-blur-md rounded-full p-2.5"
        onClick={(e) => { e.stopPropagation(); setIsFullscreen(false); }}
      >
        <X size={28} />
      </button>
      <div
        className="fullscreen-scale-in relative h-[90svh] w-[96vw] max-h-[90svh] max-w-[96vw] overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <ImageComparison
          beforeImage={beforeImageUrl}
          afterImage={afterImageUrl}
          beforeLabel={locale === "ar" ? "قبل" : "Before"}
          afterLabel={locale === "ar" ? "بعد" : "After"}
          altBefore={locale === "ar" ? "قبل التصميم" : "Before"}
          altAfter={locale === "ar" ? "بعد التصميم" : "After"}
          className="h-full w-full"
          imageFit="contain"
        />
      </div>
    </div>
  ) : null;

  // ── Result fullscreen overlay (portal — outside any stacking context) ─────────
  const resultOverlay = localShowResult && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[9998] flex flex-col animate-in fade-in duration-700"
          style={{ height: "100dvh" }}
        >
          {/* Image — fills all space above action bar */}
          <div
            className="group relative min-h-0 flex-1 overflow-hidden bg-black"
          >
            <button
              type="button"
              className="absolute top-4 right-4 z-50 rounded-full bg-black/50 p-2.5 text-white/80 opacity-80 backdrop-blur-md transition hover:bg-black/65 hover:text-white"
              onClick={() => setIsFullscreen(true)}
              aria-label={locale === "ar" ? "تكبير المعاينة" : "Open preview"}
            >
              <ZoomIn size={20} />
            </button>

            <ImageComparison
              beforeImage={beforeImageUrl}
              afterImage={afterImageUrl}
              beforeLabel={locale === "ar" ? "قبل" : "Before"}
              afterLabel={locale === "ar" ? "بعد" : "After"}
              altBefore={locale === "ar" ? "قبل التصميم" : "Before"}
              altAfter={locale === "ar" ? "بعد التصميم" : "After"}
              className="h-full w-full"
              imageFit="contain"
            />
          </div>

          {/* Completed state banner */}
          {session.status === "completed" ? (
            <div
              className="bg-black/85 px-5 py-4 text-center backdrop-blur-xl animate-in slide-in-from-bottom-2 fade-in duration-700"
              style={{ animationDelay: "400ms", animationFillMode: "backwards" }}
            >
              <p className="text-sm font-semibold text-white/90">{t.roomPreview.mobile.completed.title}</p>
              <p className="mt-1.5 text-xs leading-5 text-white/55 px-2">{t.roomPreview.mobile.completed.message}</p>
            </div>
          ) : null}

          {/* Action bar — pinned at bottom (Download only) */}
          <div
            className="flex justify-center border-t border-white/10 bg-black/85 px-4 py-4 backdrop-blur-xl animate-in slide-in-from-bottom-2 fade-in duration-700"
            style={{ animationDelay: "500ms", animationFillMode: "backwards" }}
          >
            <DownloadHoverButton
              href={session.renderResult?.imageUrl ?? "/rs/rs.png"}
              downloadName="bayt-alebaa-render.jpg"
              label={locale === "ar" ? "تحميل" : "Download"}
              ariaLabel={locale === "ar" ? "تحميل" : "Download"}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="mt-12 flex flex-col items-center">
      {/* Loading overlay */}
      {showLoadingScreen && (
        <RenderLoadingAnimation
          session={session}
          showResult={showResult}
          onMobileBack={onProcessingBack}
          mobileBackLabel={t.common.actions.back}
        />
      )}

      {!showLoadingScreen && !localShowResult ? (
        <RoomPreviewBackButton
          ariaLabel={t.common.actions.back}
          onClick={onBack}
          size={40}
          className="z-50"
          style={{ top: "max(16px, env(safe-area-inset-top))", left: 16 }}
        />
      ) : null}

      {/* CTA button (idle only) */}
      {showIdleButton && (
        <div className="relative flex items-center justify-center h-20 w-full mt-4">
          <button
            type="button"
            className={`btn-cta relative flex items-center justify-center overflow-hidden transition-[width,transform,opacity] duration-500 ease-out disabled:opacity-50 ${
              btnState === "loading" ? "rounded-full" : ""
            }`}
            style={{
              height: 68,
              width: btnState === "loading" ? 68 : 220,
              padding: btnState === "loading" ? 0 : undefined,
            }}
            onClick={() => {
              console.log("[render] clicked", {
                locked: renderClickLockedRef.current,
                btnState,
                isSavingProduct,
                sessionId: session.id,
                sessionStatus: session.status,
              });
              trackClientSessionEvent(session.id, {
                source: "mobile",
                eventType: "render_start_clicked",
                level: "info",
                metadata: {
                  locked: renderClickLockedRef.current,
                  currentBtnState: btnState,
                  isSavingProduct,
                  currentStatus: session.status,
                  hasRoomImage: Boolean(session.selectedRoom?.imageUrl),
                  hasProduct: Boolean(session.selectedProduct?.id && session.selectedProduct?.imageUrl),
                  productId: session.selectedProduct?.id ?? null,
                },
              });
              if (renderClickLockedRef.current) return;
              renderClickLockedRef.current = true;
              setBtnState("loading");
              void onCreateRender().finally(() => {
                renderClickLockedRef.current = false;
              });
            }}
            disabled={btnState === "loading"}
          >
            {btnState === "idle" && (
              <div className="button-state-in flex items-center gap-2">
                <span className="text-xl font-bold text-[var(--text-on-gold)]">{t.common.actions.create}</span>
              </div>
            )}
            {btnState === "loading" && (
              <div className="button-state-in flex items-center justify-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="loading-dot size-2 rounded-full bg-[var(--text-on-gold)]/60"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
            )}
          </button>
        </div>
      )}

      {/* Result overlay portal */}
      {resultOverlay}

      {/* Lightbox portal */}
      {fullscreenLightbox && typeof document !== "undefined"
        ? createPortal(fullscreenLightbox, document.body)
        : null}
    </div>
  );
}
