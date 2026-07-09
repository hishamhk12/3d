import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import {
  getQrPrintLabels,
  groupQrPrintLabelsByCategory,
  QR_PRINT_CATEGORY_ORDER,
  type QrPrintLabel,
} from "@/lib/room-preview/qr-print-labels";
import { isProductCategory } from "@/lib/room-preview/validators";
import type { ProductCategory } from "@/lib/room-preview/types";

export const metadata: Metadata = {
  title: "Product QR Labels",
};

// Render on demand so QR payloads can use the deployed request environment.
export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  PARQUET: "Parquet",
  WALLPAPER: "Wallpaper",
  // Arabic per spec: never "سجادة" (rug) or "carpet roll" — these are modular
  // 50x50cm tiles, not a rug or a roll.
  CARPET_TILE: "بلاطات موكيت",
};

const TAB_LABEL_AR: Record<ProductCategory, string> = {
  PARQUET: "باركيه",
  WALLPAPER: "ورق جدران",
  CARPET_TILE: "بلاطات موكيت",
};

type QrPrintPageProps = {
  searchParams: Promise<{ category?: string }>;
};

function parseCategoryParam(raw: string | undefined): ProductCategory | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return isProductCategory(upper) ? upper : null;
}

function CategoryBadge({ category }: { category: ProductCategory }) {
  return (
    <span
      dir={category === "CARPET_TILE" ? "rtl" : "ltr"}
      className={
        "rounded-full px-3 py-1 text-xs font-bold tracking-wide print:text-[8pt] " +
        (category === "CARPET_TILE" ? "" : "uppercase ") +
        (category === "WALLPAPER"
          ? "bg-amber-100 text-amber-900"
          : category === "CARPET_TILE"
            ? "bg-sky-100 text-sky-900"
            : "bg-emerald-100 text-emerald-900")
      }
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

function LabelCard({ label }: { label: QrPrintLabel }) {
  return (
    <article
      // break-inside-avoid (screen + print): a QR card is never split across
      // two printed pages.
      className="break-inside-avoid rounded-lg border border-slate-300 bg-white p-4 text-center shadow-sm print:rounded-none print:p-3 print:shadow-none"
    >
      {label.qrDataUrl ? (
        <Image
          src={label.qrDataUrl}
          alt={`QR code for ${label.productCode}`}
          width={900}
          height={900}
          unoptimized
          className="mx-auto aspect-square w-full max-w-[260px] object-contain print:max-w-[42mm]"
        />
      ) : (
        // Extremely rare fallback: QR encoding itself failed for this SKU.
        // The card still prints with its code/scan-URL text — never blank.
        <div className="mx-auto flex aspect-square w-full max-w-[260px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 print:max-w-[42mm]">
          <ImageOff className="size-8 text-slate-400" />
        </div>
      )}
      <div className="mt-3 flex items-center justify-center">
        <CategoryBadge category={label.category} />
      </div>
      <h2 className="mt-2 break-words text-2xl font-black tracking-normal text-slate-950 print:text-[18pt]">
        {label.productCode}
      </h2>
      <p className="mt-1 break-all font-mono text-[11px] text-slate-500 print:text-[8pt]">
        /scan/{label.productCode}
      </p>

      <div className="mt-3 flex items-center justify-center gap-3 border-t border-slate-200 pt-3">
        {!label.unavailable && label.productImageUrl ? (
          <>
            <Image
              src={label.productImageUrl}
              alt=""
              width={96}
              height={96}
              unoptimized
              className="h-12 w-12 rounded border border-slate-200 object-cover print:h-9 print:w-9"
            />
            <p className="min-w-0 break-words text-left text-xs font-semibold text-slate-700 print:text-[8pt]">
              {label.productName ?? CATEGORY_LABEL[label.category]}
            </p>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 print:h-9 print:w-9">
              <ImageOff className="size-5 text-slate-400" />
            </span>
            <p className="min-w-0 text-left text-xs font-semibold text-slate-400 print:text-[8pt]">
              Product data unavailable
            </p>
          </>
        )}
      </div>
    </article>
  );
}

function CategorySection({
  category,
  labels,
  isFirst,
}: {
  category: ProductCategory;
  labels: QrPrintLabel[];
  isFirst: boolean;
}) {
  if (labels.length === 0) return null;

  return (
    <section
      // Each category starts on a fresh printed page (except the first
      // section, which already starts the first page) — only relevant in the
      // "all categories" view, since a single-category view is one section.
      className={isFirst ? "" : "print:break-before-page"}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900 print:mb-3 print:text-[13pt]">
        {CATEGORY_LABEL[category]}
        <span className="text-sm font-normal text-slate-400 print:text-[9pt]">({labels.length})</span>
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
        {labels.map((label) => (
          <LabelCard key={label.productCode} label={label} />
        ))}
      </div>
    </section>
  );
}

export default async function ProductQrPrintPage({ searchParams }: QrPrintPageProps) {
  const { category: rawCategory } = await searchParams;
  const activeCategory = parseCategoryParam(rawCategory);
  const labels = await getQrPrintLabels(activeCategory);

  // Grouped by category, in the fixed QR_PRINT_CATEGORY_ORDER, for the "all"
  // view. In a single-category view this is just one group (still built the
  // same way so LabelCard/CategorySection stay identical in both modes).
  const visibleGroups = groupQrPrintLabelsByCategory(labels, activeCategory);

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-slate-950 print:min-h-0 print:px-0 print:py-0">
      <section className="mx-auto max-w-6xl print:max-w-none">
        <div className="mb-6 flex flex-col gap-2 border-b border-slate-200 pb-5 print:hidden">
          <h1 className="text-3xl font-bold tracking-normal text-slate-950">
            Product QR Labels
          </h1>
          <p className="text-sm text-slate-600">
            Press Ctrl + P to print. Each printed QR opens its permanent product scan page.
            Product names and images are loaded from PDC.
          </p>
        </div>

        {/* Category tabs / filters — screen only, never printed */}
        <nav dir="rtl" className="mb-8 flex flex-wrap items-center gap-2 print:hidden" aria-label="تصفية حسب الفئة">
          <Link
            href="/qr-print"
            className={
              "rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors " +
              (!activeCategory
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 text-slate-700 hover:bg-slate-50")
            }
          >
            الكل
          </Link>
          {QR_PRINT_CATEGORY_ORDER.map((category) => (
            <Link
              key={category}
              href={`/qr-print?category=${category}`}
              className={
                "rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors " +
                (activeCategory === category
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50")
              }
            >
              {TAB_LABEL_AR[category]}
            </Link>
          ))}

          {/* Quick link — jumps straight to the carpet-tiles-only print view. */}
          <Link
            href="/qr-print?category=CARPET_TILE"
            className="ms-auto rounded-full border border-sky-300 bg-sky-50 px-4 py-1.5 text-sm font-semibold text-sky-800 transition-colors hover:bg-sky-100"
          >
            طباعة بلاطات الموكيت فقط
          </Link>
        </nav>

        {labels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center print:hidden">
            <p className="font-semibold text-slate-900">No QR products found.</p>
            <p className="mt-2 text-sm text-slate-600">
              {activeCategory
                ? "No SKUs in the manifest for this category yet."
                : "Add product SKUs to the QR manifest, then refresh this page."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-10 print:gap-0">
            {visibleGroups.map((group, index) => (
              <CategorySection
                key={group.category}
                category={group.category}
                labels={group.labels}
                isFirst={index === 0}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
