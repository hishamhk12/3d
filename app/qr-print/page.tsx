import type { Metadata } from "next";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { getQrPrintLabels } from "@/lib/room-preview/qr-print-labels";
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

export default async function ProductQrPrintPage() {
  const labels = await getQrPrintLabels();

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-slate-950 print:min-h-0 print:px-0 print:py-0">
      <section className="mx-auto max-w-6xl print:max-w-none">
        <div className="mb-8 flex flex-col gap-2 border-b border-slate-200 pb-5 print:hidden">
          <h1 className="text-3xl font-bold tracking-normal text-slate-950">
            Product QR Labels
          </h1>
          <p className="text-sm text-slate-600">
            Press Ctrl + P to print. Each printed QR opens its permanent product scan page.
            Product names and images are loaded from PDC.
          </p>
        </div>

        {labels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center print:hidden">
            <p className="font-semibold text-slate-900">No QR products found.</p>
            <p className="mt-2 text-sm text-slate-600">
              Add product SKUs to the QR manifest, then refresh this page.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
            {labels.map((label) => (
              <article
                key={label.productCode}
                className="break-inside-avoid rounded-lg border border-slate-300 bg-white p-4 text-center shadow-sm print:rounded-none print:p-3 print:shadow-none"
              >
                <Image
                  src={label.qrDataUrl}
                  alt={`QR code for ${label.productCode}`}
                  width={900}
                  height={900}
                  unoptimized
                  className="mx-auto aspect-square w-full max-w-[260px] object-contain print:max-w-[42mm]"
                />
                <div className="mt-3 flex items-center justify-center">
                  <span
                    dir={label.category === "CARPET_TILE" ? "rtl" : "ltr"}
                    className={
                      "rounded-full px-3 py-1 text-xs font-bold tracking-wide print:text-[8pt] " +
                      (label.category === "CARPET_TILE" ? "" : "uppercase ") +
                      (label.category === "WALLPAPER"
                        ? "bg-amber-100 text-amber-900"
                        : label.category === "CARPET_TILE"
                          ? "bg-sky-100 text-sky-900"
                          : "bg-emerald-100 text-emerald-900")
                    }
                  >
                    {CATEGORY_LABEL[label.category]}
                  </span>
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
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
