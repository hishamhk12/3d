"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { Wifi } from "lucide-react";
import BrandedGlassStage from "@/components/room-preview/BrandedGlassStage";
import RoomPreviewBackButton from "@/components/room-preview/RoomPreviewBackButton";
import { EventTilt3DCard } from "@/features/room-preview/screen/EventTilt3DCard";
import { getScreenDisplayProducts } from "@/features/room-preview/screen/screen-display-products";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { useI18n } from "@/lib/i18n/provider";
import type { RoomPreviewSession, SelectedProduct } from "@/lib/room-preview/types";

// ─── Figma design tokens (node 10:936 — visionOS components) ─────────────────
// Values read directly from the original Figma components and preserved exactly:
// border-2 white, backdrop-blur 67.955px, glass gradient fill, inner highlight,
// radii (bar 60 / card 40 / tile-button 24), button 44px round, icon 24px.

const GLASS_GRADIENT =
  "linear-gradient(90deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.1) 100%), linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.1) 100%)";
const GLASS_HIGHLIGHT =
  "inset -1px 0px 4px 0px rgba(255,255,255,0.25), inset 2px 1px 4px 0px rgba(255,255,255,0.25)";
const GALLERY_SHADOW =
  "3px 34px 44px 0px rgba(0,0,0,0.25), 0px 10px 20px 0px rgba(0,0,0,0.25)";
const VISION_FONT =
  '"SF Compact Rounded", "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// Stage design canvas — the cleaner non-overlapping arrangement of the same
// components at their original Figma dimensions. Uniformly scaled to fit the
// kiosk viewport (transform only — component dimensions are never altered).
const DESIGN_W = 1308;
const DESIGN_H = 780;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Live remaining-session time derived from the session's real expiresAt. */
function useSessionTimeRemaining(expiresAt: string | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => {
    if (!expiresAt) return null;
    return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      setRemaining(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  // Derive null directly when there is no expiry instead of resetting state.
  return expiresAt ? remaining : null;
}

/** Scales the fixed design canvas to fit its container without ever upscaling. */
function useFitScale(canvasW: number, canvasH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure the actual rendered stage box (the dvw/dvh glass panel) — the real
    // available viewport, never assumed physical dimensions.
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setScale(Math.min(width / canvasW, height / canvasH, 1));
    };
    update();

    // One resize-aware fit calculation: recompute whenever the available
    // viewport changes — element resize, window resize, orientation change,
    // fullscreen enter/exit, and (when supported) visual-viewport changes from
    // browser toolbars showing/hiding.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    document.addEventListener("fullscreenchange", update);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("fullscreenchange", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [canvasW, canvasH]);

  return { ref, scale };
}

// ─── Shared glass primitives (exact Figma styling) ───────────────────────────

/** 44px round glass button used by the browser/session bar (Figma "Button Symbol Only"). */
// ─── Session bar (Figma explorer_bar 10:1180 → remaining session time) ────────

function SessionBar({
  timeRemaining,
  statusLabel,
}: {
  timeRemaining: number | null;
  statusLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className="relative flex h-[72px] w-[975px] items-center overflow-hidden rounded-[60px] border-2 border-white/30 px-[16px] py-[14px]"
      style={{ background: GLASS_GRADIENT, backdropFilter: "blur(67.955px)" }}
    >
      {/* address field repurposed for the live remaining session time */}
      <div
        className="relative flex h-[44px] min-w-px flex-1 items-center justify-center gap-[8px] overflow-hidden rounded-[24px] border border-white px-[20px]"
        style={{
          background: "rgba(12,12,12,0.3)",
          backdropFilter: "blur(67.955px)",
          boxShadow: "inset 0px 4px 4px 0px rgba(0,0,0,0.25)",
        }}
        dir="rtl"
      >
        <span
          className="whitespace-nowrap text-[17px] leading-[22px] text-white/90"
          style={{ fontFamily: VISION_FONT, letterSpacing: "0.68px" }}
        >
          {t.roomPreview.screen.stage.timeRemaining}{" "}
          <span className="tabular-nums">{timeRemaining !== null ? formatClock(timeRemaining) : "--:--"}</span>
          <span className="px-[10px] text-white/30">·</span>
          <span className="text-white/55">{statusLabel}</span>
        </span>
      </div>

      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ boxShadow: GLASS_HIGHLIGHT }}
      />
    </div>
  );
}

// ─── Gallery (Figma gallery 21:291 → room image + product image grouped) ─────

// Empty media tiles reuse the page's existing glass language: transparent
// frosted fill (croissant background shows through), subtle white border, soft
// inner highlight, existing 24px radius. No navy/dark fallback surfaces.
const TILE_GLASS = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(67.955px)",
  WebkitBackdropFilter: "blur(67.955px)",
  boxShadow: GLASS_HIGHLIGHT,
} as const;

/**
 * A single media area: transparent frosted glass when empty, the live image
 * (object-cover, no stretch) when available. Each tile updates independently.
 */
function MediaTile({
  imageUrl,
  className,
  sizes,
  priority,
  placeholderText = null,
  caption = null,
}: {
  imageUrl: string | null;
  className: string;
  sizes: string;
  priority?: boolean;
  /** Shown when a selected product has no usable image (never hide the card). */
  placeholderText?: string | null;
  /** Small "code · category" pill anchored to the tile's bottom edge (product tiles only). */
  caption?: string | null;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-[24px] border border-white/30 ${className}`}
      style={TILE_GLASS}
    >
      {imageUrl ? (
        <Image src={imageUrl} alt="" fill sizes={sizes} className="object-cover" priority={priority} />
      ) : placeholderText ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
          <p className="text-sm font-semibold text-white/60" dir="rtl">{placeholderText}</p>
        </div>
      ) : null}
      {caption ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
          <span
            className="max-w-[92%] truncate rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm"
            style={{ fontFamily: VISION_FONT }}
            dir="rtl"
          >
            {caption}
          </span>
        </div>
      ) : null}
    </div>
  );
}

const PRODUCT_IMAGE_UNAVAILABLE = "الصورة غير متوفرة";

/** Short Arabic category name shown in each product tile's caption — same
 *  short forms used by /qr-print's compact category badges, so the wording
 *  is consistent across the kiosk screen and the printed labels. */
const SCREEN_CATEGORY_SHORT_LABEL_AR: Partial<Record<NonNullable<SelectedProduct["category"]>, string>> = {
  PARQUET: "باركيه",
  WALLPAPER: "ورق جدران",
  CARPET_TILE: "بلاطات موكيت",
  WALL_CLADDING: "كسوات الجدران",
};

/** "code · category" caption for a selected product tile, or null when there's nothing to show. */
function productTileCaption(product: SelectedProduct | null): string | null {
  if (!product?.id) return null;
  const categoryLabel = product.category ? SCREEN_CATEGORY_SHORT_LABEL_AR[product.category] : null;
  return categoryLabel ? `${product.id} · ${categoryLabel}` : product.id;
}

function GalleryCard({
  roomImageUrl,
  products,
}: {
  roomImageUrl: string | null;
  products: SelectedProduct[];
}) {
  // Fixed order (floor → walls) comes from getScreenDisplayProducts. With no
  // selection yet, a single empty frosted tile keeps the original composition.
  // Two 226px tiles + 10px gap = 462px ≤ the 476px row, so nothing overflows
  // and the room image / QR keep their exact size and position.
  const productTiles: Array<SelectedProduct | null> =
    products.length > 0 ? products : [null];

  return (
    <div
      className="flex shrink-0 flex-col items-start overflow-hidden rounded-[40px] border-2 border-white/30 p-[17px]"
      style={{ background: GLASS_GRADIENT, backdropFilter: "blur(67.955px)", boxShadow: GALLERY_SHADOW }}
    >
      <div className="flex h-[476px] items-start gap-[10px]">
        {/* large area → selected room image (empty frosted glass until selected).
            3D-card motion replays when the room image first appears or changes. */}
        <EventTilt3DCard trigger={roomImageUrl} className="shrink-0">
          <MediaTile imageUrl={roomImageUrl} className="h-[476px] w-[466px]" sizes="466px" priority />
        </EventTilt3DCard>

        {/* small area → ALL selected products stacked vertically (floor first,
            walls second). Each tile's 3D-card motion replays independently
            when its product image first appears or changes. */}
        <div className="flex flex-col gap-[10px]">
          {productTiles.map((product, index) => (
            <EventTilt3DCard
              key={product ? `${product.targetSurface ?? "surface"}-${product.id ?? index}` : "empty"}
              trigger={product?.imageUrl ?? null}
              className="shrink-0"
            >
              <MediaTile
                imageUrl={product?.imageUrl ?? null}
                placeholderText={product && !product.imageUrl ? PRODUCT_IMAGE_UNAVAILABLE : null}
                caption={product?.imageUrl ? productTileCaption(product) : null}
                className="size-[226px]"
                sizes="226px"
              />
            </EventTilt3DCard>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── QR card (Figma video-player 20:937 → session QR code) ───────────────────

function QrCard({
  qrDataUrl,
  qrAlt,
  baseUrlMissingTitle,
  baseUrlMissingDescription,
}: {
  qrDataUrl: string | null;
  qrAlt: string;
  baseUrlMissingTitle: string;
  baseUrlMissingDescription: string;
}) {
  return (
    <div
      className="relative size-[340px] overflow-hidden rounded-[40px] border-2 border-white/30"
      style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(67.955px)" }}
    >
      {/* QR replaces the original media; frame/controls/effects preserved */}
      <div className="absolute inset-0 flex items-center justify-center">
        {qrDataUrl ? (
          <div className="relative size-[300px] rounded-[24px] bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
            <Image src={qrDataUrl} alt={qrAlt} fill sizes="300px" unoptimized className="rounded-[16px] p-4" />
          </div>
        ) : (
          <div className="mx-10 rounded-[24px] border border-[#F1B434]/25 bg-[#F1B434]/10 px-8 py-8 text-center backdrop-blur-xl">
            <p className="text-[17px] font-bold text-[#F1B434]" style={{ fontFamily: VISION_FONT }}>{baseUrlMissingTitle}</p>
            <p className="mt-2 text-sm leading-6 text-[#F1B434]/70">{baseUrlMissingDescription}</p>
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Connection card (Figma incoming-call-popup 12:1040 → connection state) ──

// Wi-Fi indicator states.
//  • inactive: existing neutral grey glass badge (preserved).
//  • active:   exact iOS active Wi-Fi fill from Figma node 6023:1853 —
//    rgba(0,136,255,0.95) blue layered over rgba(255,255,255,0.5), white icon.
const WIFI_INACTIVE_BG = "linear-gradient(180deg, #b7b2ac 0%, #a09a9b 100%)";
const WIFI_ACTIVE_BG =
  "linear-gradient(90deg, rgba(0,136,255,0.95) 0%, rgba(0,136,255,0.95) 100%), linear-gradient(90deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 100%)";

function ConnectionCard({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  const stateLabel = connected
    ? t.roomPreview.screen.stage.connected
    : t.roomPreview.screen.stage.waitingConnection;

  return (
    <div
      className="relative flex w-[344px] items-center overflow-hidden rounded-[40px] border-2 border-white/30 p-[16px]"
      style={{ background: GLASS_GRADIENT, backdropFilter: "blur(67.955px)" }}
      dir="rtl"
    >
      <div className="flex items-center gap-[12px]">
        {/* circular Wi-Fi badge — neutral glass when waiting, exact Figma iOS
            blue (node 6023:1853) once the phone genuinely connects. The CSS
            transition only fires on the real inactive→active value change. */}
        <div
          className="flex size-[48px] shrink-0 items-center justify-center overflow-hidden rounded-[90px] transition-[background,transform] duration-300 ease-out"
          style={{
            background: connected ? WIFI_ACTIVE_BG : WIFI_INACTIVE_BG,
            transform: connected ? "scale(1.04)" : "scale(1)",
            boxShadow: "2px 1px 5px 0px rgba(0,0,0,0.25)",
          }}
        >
          <Wifi size={24} strokeWidth={2.2} className="text-white" />
        </div>
        <p className="text-[17px] leading-[22px] text-white/90" style={{ fontFamily: VISION_FONT, letterSpacing: "0.68px" }}>
          {stateLabel}
        </p>
      </div>

      <div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ boxShadow: GLASS_HIGHLIGHT }} />
    </div>
  );
}

// ─── Stage composition ───────────────────────────────────────────────────────

// ─── Back button (Figma Vision Pro Spatial UI Kit, node 48:2362) ─────────────
// Exact component: a 36×36 frame, bg rgba(255,255,255,0.3), rounded-[40px]
// (circular), holding the original 36×36 white left-chevron SVG. The node
// exposes no border/shadow; a backdrop blur is applied so it reads as the
// visionOS glass it is. Scaled uniformly (one factor on the whole component,
// icon included) and anchored to the outer glass panel's top-left corner.

/** Base size of the whole component at fit-scale 1.0 (uniform scale of the 36px Figma node). */
const BACK_BTN_BASE = 56;
/** Balanced padding from the outer glass panel's top & left edges at fit-scale 1.0. */
const BACK_BTN_INSET = 48;

function BackToHomeButton({ scale }: { scale: number }) {
  const size = BACK_BTN_BASE * scale;
  const inset = BACK_BTN_INSET * scale;
  return (
    <RoomPreviewBackButton
      href={ROOM_PREVIEW_ROUTES.landing}
      ariaLabel="العودة إلى الصفحة الرئيسية"
      size={size}
      style={{
        top: inset,
        left: inset,
      }}
    />
  );
}

interface SessionStageProps {
  session: RoomPreviewSession;
  qrDataUrl: string | null;
  statusLabel: string;
  devEntryHref: string | null;
}

export default function SessionStage({ session, qrDataUrl, statusLabel, devEntryHref }: SessionStageProps) {
  const { t } = useI18n();
  const timeRemaining = useSessionTimeRemaining(session.expiresAt);
  const { ref, scale } = useFitScale(DESIGN_W, DESIGN_H);

  return (
    <BrandedGlassStage backgroundImage='url("/croissant.jpg")'>
      {/* Back button anchored to the outer glass panel's top-left corner */}
      <BackToHomeButton scale={scale} />

      <div ref={ref} className="absolute inset-0 z-[1] flex items-center justify-center overflow-hidden p-6 md:p-10">
        <div
          className="flex flex-col items-center gap-[32px]"
          style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})`, transformOrigin: "center center" }}
          dir="ltr"
        >
        <SessionBar timeRemaining={timeRemaining} statusLabel={statusLabel} />

        <div className="flex w-full items-center justify-center gap-[48px]">
          <GalleryCard
            roomImageUrl={session.selectedRoom?.imageUrl ?? null}
            products={getScreenDisplayProducts(session)}
          />

          <div className="flex flex-col items-center gap-[24px]">
            {/* 3D-card motion replays once when the phone connects (waiting → connected). */}
            <EventTilt3DCard trigger={session.mobileConnected}>
              <QrCard
                qrDataUrl={qrDataUrl}
                qrAlt={t.roomPreview.qr.alt}
                baseUrlMissingTitle={t.roomPreview.screen.baseUrlMissingTitle}
                baseUrlMissingDescription={t.roomPreview.screen.baseUrlMissingDescription}
              />
            </EventTilt3DCard>
            <ConnectionCard
              connected={session.customerRoleSelected === true}
            />
            {devEntryHref ? (
              <a
                href={devEntryHref}
                className="flex items-center gap-2 rounded-2xl border border-dashed border-yellow-400/35 bg-yellow-400/[0.05] px-4 py-2 text-sm font-semibold text-yellow-400/75 transition-colors hover:bg-yellow-400/10 hover:text-yellow-400"
                dir="rtl"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
                Dev — الدخول بدون QR
              </a>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </BrandedGlassStage>
  );
}
