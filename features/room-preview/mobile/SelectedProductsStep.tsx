"use client";

import Image from "next/image";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import {
  getSelectedProductCount,
  getSelectedTargetSurfaces,
  normalizeSelectedProducts,
} from "@/lib/room-preview/selected-products";
import type {
  RoomPreviewSession,
  SelectedProduct,
  TargetSurface,
} from "@/lib/room-preview/types";

type Locale = "ar" | "en";

type SelectedProductsStepProps = {
  session: RoomPreviewSession;
  locale: Locale;
  isBusy: boolean;
  removingSurface?: TargetSurface | null;
  onAddAnother: () => void;
  onChangeSurface: (surface: TargetSurface) => void;
  onRemoveSurface: (surface: TargetSurface) => void;
  onCreateRender: () => void;
};

const SURFACE_ORDER = ["floor", "walls"] as const satisfies readonly TargetSurface[];

function labels(locale: Locale) {
  const ar = locale === "ar";
  return {
    title: ar ? "المنتجات المختارة" : "Selected products",
    floor: ar ? "الأرضية" : "Flooring",
    walls: ar ? "ورق الجدران" : "Wallpaper",
    change: ar ? "تغيير" : "Change",
    remove: ar ? "إزالة" : "Remove",
    removing: ar ? "جارٍ الإزالة..." : "Removing...",
    addAnother: ar ? "إضافة منتج آخر" : "Add another product",
    surfacesFull: ar ? "تم اختيار الأرضية وورق الجدران" : "Flooring and wallpaper selected",
    createOne: ar ? "إنشاء التصميم" : "Generate preview",
    createTwo: ar ? "إنشاء التصميم" : "Generate preview",
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
    <article className="w-full rounded-[28px] border border-[var(--border)] bg-white p-3 text-start shadow-[var(--shadow-sm)]">
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

export default function SelectedProductsStep({
  session,
  locale,
  isBusy,
  removingSurface = null,
  onAddAnother,
  onChangeSurface,
  onRemoveSurface,
  onCreateRender,
}: SelectedProductsStepProps) {
  const l = labels(locale);
  const selectedProducts = normalizeSelectedProducts(session);
  const selectedCount = getSelectedProductCount(selectedProducts);
  const selectedSurfaces = getSelectedTargetSurfaces(selectedProducts);
  const canAddAnother = selectedCount > 0 && selectedCount < 2;
  const canCreateRender = selectedCount > 0 && selectedCount <= 2 && !isBusy;

  return (
    <section className="flex w-full flex-col items-center py-6 text-center" data-mobile-step="selected_products">
      <div className="mx-auto flex w-full max-w-[345px] flex-col items-center">
        <h2 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
          {l.title}
        </h2>

        <div className="mt-5 flex w-full flex-col gap-3">
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
        </div>

        <div className="mt-5 flex w-full flex-col gap-3">
          {canAddAnother ? (
            <MobileActionButton
              variant="light"
              onClick={onAddAnother}
              disabled={isBusy}
              icon={<Plus className="size-5" />}
            >
              {l.addAnother}
            </MobileActionButton>
          ) : selectedSurfaces.length === 2 ? (
            <MobileActionButton variant="light" disabled>
              {l.surfacesFull}
            </MobileActionButton>
          ) : null}

          <MobileActionButton
            variant="blue"
            onClick={onCreateRender}
            disabled={!canCreateRender}
            loading={isBusy && selectedCount === 1}
          >
            {selectedCount === 2 ? l.createTwo : l.createOne}
          </MobileActionButton>
        </div>
      </div>
    </section>
  );
}
