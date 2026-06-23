import type { Metadata } from "next";
import Image from "next/image";
import QRCode from "qrcode";
import { listQrProducts } from "@/lib/room-preview/qr-products";
import type { ProductCategory } from "@/lib/room-preview/types";

export const metadata: Metadata = {
  title: "Product QR Labels",
};

// Render on demand so QR payloads can use the deployed request environment.
export const dynamic = "force-dynamic";

type QrLabel = {
  productCode: string;
  category: ProductCategory;
  categoryLabel: string;
  scanUrl: string;
  qrDataUrl: string;
  productImageUrl: string;
};

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  PARQUET: "Parquet",
  WALLPAPER: "Wallpaper",
};

/** Absolute scan URL for the QR payload. Uses NEXT_PUBLIC_BASE_URL first, then
 *  VERCEL_URL in deployed environments. Falls back to relative /scan only for
 *  local development without a configured base URL. */
function buildScanUrl(productCode: string): string {
  const configuredBase =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = configuredBase.replace(/\/+$/, "");
  return `${base}/scan/${encodeURIComponent(productCode)}`;
}

async function getQrLabels(): Promise<QrLabel[]> {
  const products = listQrProducts();

  return Promise.all(
    products.map(async (product) => {
      const scanUrl = buildScanUrl(product.id);
      const qrDataUrl = await QRCode.toDataURL(scanUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 900,
      });

      return {
        productCode: product.id,
        category: product.category,
        categoryLabel: CATEGORY_LABEL[product.category],
        scanUrl,
        qrDataUrl,
        productImageUrl: product.imageUrl,
      } satisfies QrLabel;
    }),
  );
}

export default async function ProductQrPrintPage() {
  const labels = await getQrLabels();

  return (
    <main className="min-h-screen bg-white px-6 py-8 text-slate-950 print:min-h-0 print:px-0 print:py-0">
      <section className="mx-auto max-w-6xl print:max-w-none">
        <div className="mb-8 flex flex-col gap-2 border-b border-slate-200 pb-5 print:hidden">
          <h1 className="text-3xl font-bold tracking-normal text-slate-950">
            Product QR Labels
          </h1>
          <p className="text-sm text-slate-600">
            Press Ctrl + P to print. Each printed QR opens its permanent product scan page.
          </p>
        </div>

        {labels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center print:hidden">
            <p className="font-semibold text-slate-900">No QR products found.</p>
            <p className="mt-2 text-sm text-slate-600">
              Add product images under public/qr-products/parquet/ or
              public/qr-products/wallpaper/, then refresh this page.
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
                    className={
                      "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide print:text-[8pt] " +
                      (label.category === "WALLPAPER"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-emerald-100 text-emerald-900")
                    }
                  >
                    {label.categoryLabel}
                  </span>
                </div>
                <h2 className="mt-2 break-words text-2xl font-black tracking-normal text-slate-950 print:text-[18pt]">
                  {label.productCode}
                </h2>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500 print:text-[8pt]">
                  /scan/{label.productCode}
                </p>

                <div className="mt-3 flex items-center justify-center gap-3 border-t border-slate-200 pt-3">
                  <Image
                    src={label.productImageUrl}
                    alt=""
                    width={96}
                    height={96}
                    unoptimized
                    className="h-12 w-12 rounded border border-slate-200 object-cover print:h-9 print:w-9"
                  />
                  <p className="min-w-0 break-all text-left text-xs font-semibold text-slate-700 print:text-[8pt]">
                    {label.categoryLabel}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
