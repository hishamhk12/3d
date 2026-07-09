"use client";

import Image from "next/image";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import { normalizeSelectedProducts } from "@/lib/room-preview/selected-products";
import type {
  RoomPreviewSession,
  SelectedProduct,
  SelectedProductsBySurface,
  TargetSurface,
} from "@/lib/room-preview/types";

type Locale = "ar" | "en";

type SelectedProductsStepProps = {
  session: RoomPreviewSession;
  locale: Locale;
  isBusy: boolean;
  removingSurface?: TargetSurface | null;
  /** Inline error from a product add/remove action, shown inside the step. */
  errorText?: string | null;
  /** Called with the missing surface (walls/floor) so the scan step can hint it. */
  onAddAnother: (missingSurface: TargetSurface | null) => void;
  onChangeSurface: (surface: TargetSurface) => void;
  onRemoveSurface: (surface: TargetSurface) => void;
  onCreateRender: () => void;
};

const SURFACE_ORDER = ["floor", "walls"] as const satisfies readonly TargetSurface[];

/**
 * Products to DISPLAY: every entry in selectedProductsBySurface that has an id
 * and an image — the name is optional for display (the card falls back to the
 * id). The stricter normalize (which requires a name) is only the fallback for
 * legacy sessions that predate the by-surface map. This guarantees the second
 * selected product is always listed, never just the primary product.
 */
function getDisplayProducts(session: RoomPreviewSession): SelectedProductsBySurface {
  const raw = session.selectedProductsBySurface;
  const display: SelectedProductsBySurface = {};
  for (const surface of SURFACE_ORDER) {
    const product = raw?.[surface];
    if (product?.id && product.imageUrl) {
      display[surface] = product;
    }
  }
  if (display.floor || display.walls) return display;
  return normalizeSelectedProducts(session);
}

function labels(locale: Locale) {
  const ar = locale === "ar";
  return {
    title: ar ? "المنتجات المختارة" : "Selected products",
    floor: ar ? "الأرضية" : "Flooring",
    walls: ar ? "ورق الجدران" : "Wallpaper",
    change: ar ? "تغيير" : "Change",
    remove: ar ? "إزالة" : "Remove",
    removing: ar ? "جارٍ الإزالة..." : "Removing...",
    chooseAnother: ar ? "اختيار منتج آخر" : "Choose another product",
    surfacesFull: ar ? "تم اختيار الحد الأقصى من المنتجات" : "Maximum products selected",
    create: ar ? "إنشاء التصميم" : "Generate preview",
  };
}

function ProductCard({
  locale,
  product,
  surface,
  isBusy,
  isRemoving,
  onChange,
  onRemove,
}: {
  locale: Locale;
  product: SelectedProduct;
  surface: TargetSurface;
  isBusy: boolean;
  isRemoving: boolean;
  onChange: () => void;
  onRemove: () => void;
}) {
  const l = labels(locale);
  const surfaceLabel = surface === "floor" ? l.floor : l.walls;

  return (
    <article className="w-full flex-none rounded-[28px] border border-[var(--border)] bg-white p-3 text-start shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[20px] border border-[var(--border)] bg-white">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name ?? product.id ?? surfaceLabel}
              fill
              unoptimized
              className="object-contain p-2"
              sizes="80px"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[var(--brand-cyan)]">{surfaceLabel}</p>
          <p className="mt-1 break-all font-mono text-lg font-black text-[var(--text-primary)]">
            {product.id}
          </p>
          {product.name ? (
            <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{product.name}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onChange}
          disabled={isBusy || isRemoving}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[22px] bg-[rgba(120,120,128,0.16)] px-3 text-sm font-bold text-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className="size-4" />
          {l.change}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={isBusy || isRemoving}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[22px] border border-red-200 bg-red-50 px-3 text-sm font-bold text-red-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-4" />
          {isRemoving ? l.removing : l.remove}
        </button>
      </div>
    </article>
  );
}

/**
 * Fixed-shell layout: header (flex-none) → scrollable content (flex-1) →
 * pinned footer with the create button (flex-none). Cards appearing or
 * disappearing only affect the inner scroll area — the header and the create
 * button never move, so the page does not jump on iPhone.
 */
export default function SelectedProductsStep({
  session,
  locale,
  isBusy,
  removingSurface = null,
  errorText = null,
  onAddAnother,
  onChangeSurface,
  onRemoveSurface,
  onCreateRender,
}: SelectedProductsStepProps) {
  const l = labels(locale);
  const selectedProducts = getDisplayProducts(session);
  const selectedSurfaces = SURFACE_ORDER.filter((surface) => Boolean(selectedProducts[surface]));
  const selectedCount = selectedSurfaces.length;
  const canAddAnother = selectedCount > 0 && selectedCount < 2;
  const canCreateRender = selectedCount > 0 && selectedCount <= 2 && !isBusy;
  // With exactly one product selected, the scan step gets the other surface as a hint.
  const missingSurface: TargetSurface | null =
    selectedCount === 1 ? (selectedProducts.floor ? "walls" : "floor") : null;

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col text-center"
      data-mobile-step="selected_products"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[345px] flex-col">
        {/* Header — fixed at the top (padding clears the absolute back button) */}
        <div className="flex-none pb-3 pt-14">
          <h2 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
            {l.title}
          </h2>
        </div>

        {/* Content — the only scrollable region */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          <div className="flex w-full flex-col gap-3">
            {SURFACE_ORDER.map((surface) => {
              const product = selectedProducts[surface];
              if (!product) return null;
              return (
                <ProductCard
                  key={surface}
                  locale={locale}
                  product={product}
                  surface={surface}
                  isBusy={isBusy}
                  isRemoving={removingSurface === surface}
                  onChange={() => onChangeSurface(surface)}
                  onRemove={() => onRemoveSurface(surface)}
                />
              );
            })}

            {canAddAnother ? (
              <MobileActionButton
                variant="light"
                onClick={() => onAddAnother(missingSurface)}
                disabled={isBusy}
                icon={<Plus className="size-5" />}
              >
                {l.chooseAnother}
              </MobileActionButton>
            ) : selectedCount === 2 ? (
              <MobileActionButton variant="light" disabled>
                {l.surfacesFull}
              </MobileActionButton>
            ) : null}

            {errorText ? (
              <p className="w-full rounded-[18px] border border-red-400/25 bg-red-50 px-4 py-3 text-center text-sm leading-6 text-red-700">
                {errorText}
              </p>
            ) : null}
          </div>
        </div>

        {/* Footer — the create button stays pinned to the bottom */}
        <div className="flex-none pb-1 pt-3">
          <MobileActionButton
            variant="blue"
            onClick={onCreateRender}
            disabled={!canCreateRender}
            loading={isBusy && selectedCount === 1}
          >
            {l.create}
          </MobileActionButton>
        </div>
      </div>
    </section>
  );
}
