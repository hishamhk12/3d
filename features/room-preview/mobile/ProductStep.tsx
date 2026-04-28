"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { RoomPreviewProduct, SelectedProduct } from "@/lib/room-preview/types";

interface ProductStepProps {
  isSavingProduct: boolean;
  products: RoomPreviewProduct[];
  selectedProduct: SelectedProduct | null;
  onProductSelect: (id: string) => void;
}

export default function ProductStep({
  isSavingProduct,
  products,
  selectedProduct,
  onProductSelect,
}: ProductStepProps) {
  const { dir, t } = useI18n();
  const sectionAlignClass = dir === "rtl" ? "text-right" : "text-left";
  const activeProduct = selectedProduct ?? products[0];
  const activeIndex   = products.findIndex((p) => p.id === activeProduct?.id);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < products.length - 1;

  const navigate = (direction: "prev" | "next") => {
    const newIndex =
      direction === "prev"
        ? Math.max(0, activeIndex - 1)
        : Math.min(products.length - 1, activeIndex + 1);

    if (newIndex === activeIndex) return;

    void onProductSelect(products[newIndex].id);
  };

  return (
    <section
      className={`mt-8 rounded-[28px] border border-[var(--border)] bg-[var(--bg-surface)] p-5 ${sectionAlignClass}`}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-cyan)] uppercase">
            {t.roomPreview.mobile.product.eyebrow}
          </p>
          <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--text-primary)]">
            {t.roomPreview.mobile.product.title}
          </h2>
        </div>

      </div>

      <div className="mt-14 flex w-full flex-col items-center">
        {/* ── Hero product preview ─────────────────────────────────────── */}
        <div className="perspective-1000 group relative mb-10 flex h-[45vh] min-h-[300px] w-full items-center justify-center">
          <div className="pointer-events-none absolute inset-0 -z-10 mx-auto max-w-[200px] rounded-[100%] bg-[var(--brand-cyan)]/15 opacity-70 blur-[60px] transition-all duration-700 ease-out group-hover:scale-110 group-hover:bg-[var(--brand-cyan)]/25" />

          {/* سهم يسار */}
          <button
            type="button"
            onClick={() => navigate(dir === "rtl" ? "next" : "prev")}
            disabled={isSavingProduct || (dir === "rtl" ? !canNext : !canPrev)}
            aria-label="السابق"
            className={`
              absolute left-0 z-20 flex h-10 w-10 items-center justify-center
              rounded-full border transition-all duration-200
              ${(dir === "rtl" ? !canNext : !canPrev)
                ? "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] opacity-25 cursor-not-allowed"
                : "border-[rgba(0,175,215,0.35)] bg-[rgba(0,175,215,0.12)] text-[var(--brand-cyan)] shadow-[0_0_14px_rgba(0,175,215,0.25)] hover:bg-[rgba(0,175,215,0.22)] hover:shadow-[0_0_20px_rgba(0,175,215,0.40)] active:scale-90"
              }
            `}
          >
            <ChevronLeft className="size-5" />
          </button>

          <div
            key={activeProduct?.id ?? "empty"}
            className="product-preview-in relative z-10 flex h-full w-full items-center justify-center"
          >
            {activeProduct?.imageUrl && (
              <Image
                src={activeProduct.imageUrl}
                alt="Premium Product Preview"
                fill
                unoptimized
                className="object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.30)] transition-all duration-500 group-hover:drop-shadow-[0_30px_50px_rgba(0,0,0,0.40)]"
                sizes="(max-width: 768px) 80vw, 360px"
              />
            )}
          </div>

          {/* سهم يمين */}
          <button
            type="button"
            onClick={() => navigate(dir === "rtl" ? "prev" : "next")}
            disabled={isSavingProduct || (dir === "rtl" ? !canPrev : !canNext)}
            aria-label="التالي"
            className={`
              absolute right-0 z-20 flex h-10 w-10 items-center justify-center
              rounded-full border transition-all duration-200
              ${(dir === "rtl" ? !canPrev : !canNext)
                ? "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] opacity-25 cursor-not-allowed"
                : "border-[rgba(0,175,215,0.35)] bg-[rgba(0,175,215,0.12)] text-[var(--brand-cyan)] shadow-[0_0_14px_rgba(0,175,215,0.25)] hover:bg-[rgba(0,175,215,0.22)] hover:shadow-[0_0_20px_rgba(0,175,215,0.40)] active:scale-90"
              }
            `}
          >
            <ChevronRight className="size-5" />
          </button>

          {activeProduct?.barcode && (
            <div className="pointer-events-none absolute bottom-0 z-20 flex w-full translate-y-1/2 justify-center">
              <div className="flex flex-col items-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-panel)] px-5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.20)] backdrop-blur-md">
                <p className="text-sm font-bold text-[var(--text-secondary)]">
                  {activeProduct.barcode}
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
