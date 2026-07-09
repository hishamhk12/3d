import "server-only";

import QRCode from "qrcode";
import { resolveProductByCode } from "@/lib/room-preview/product-resolver";
import { listQrProducts } from "@/lib/room-preview/qr-products";
import type { ProductCategory } from "@/lib/room-preview/types";

export type QrPrintLabel = {
  productCode: string;
  category: ProductCategory;
  scanUrl: string;
  qrDataUrl: string;
  /** Product name from PDC; null when the product could not be resolved. */
  productName: string | null;
  /** Product image URL from PDC; null when the product could not be resolved. */
  productImageUrl: string | null;
  /** True when PDC could not resolve the product (no local image fallback). */
  unavailable: boolean;
};

/** Batched PDC lookups: enough parallelism to keep the page fast without
 *  hammering PDC after a Render.com cold start. */
const PDC_LOOKUP_CONCURRENCY = 8;

/** Absolute scan URL for the QR payload. Uses NEXT_PUBLIC_BASE_URL first, then
 *  VERCEL_URL in deployed environments. Falls back to relative /scan only for
 *  local development without a configured base URL. */
export function buildScanUrl(productCode: string): string {
  const configuredBase =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = configuredBase.replace(/\/+$/, "");
  return `${base}/scan/${encodeURIComponent(productCode)}`;
}

async function buildLabel(productCode: string, category: ProductCategory): Promise<QrPrintLabel> {
  const scanUrl = buildScanUrl(productCode);
  const qrDataUrl = await QRCode.toDataURL(scanUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 900,
  });

  // Product name/image come from PDC via the server-side resolver (the
  // resolver's development-only manifest fallback keeps local work possible).
  // On failure the label renders as unavailable — never a stale local image.
  const result = await resolveProductByCode(productCode);

  if (result.ok) {
    return {
      productCode,
      category,
      scanUrl,
      qrDataUrl,
      productName: result.product.name,
      productImageUrl: result.product.imageUrl,
      unavailable: false,
    };
  }

  return {
    productCode,
    category,
    scanUrl,
    qrDataUrl,
    productName: null,
    productImageUrl: null,
    unavailable: true,
  };
}

/**
 * Build the printable QR labels. The local manifest is used only as the list
 * of SKUs to print — all displayed product data is resolved server-side.
 *
 * When `category` is provided, the manifest is filtered to that category
 * BEFORE any PDC lookup runs — a category-scoped page (e.g. CARPET_TILE only)
 * never calls resolveProductByCode for the other categories' SKUs.
 */
export async function getQrPrintLabels(category?: ProductCategory | null): Promise<QrPrintLabel[]> {
  const entries = category
    ? listQrProducts().filter((entry) => entry.category === category)
    : listQrProducts();
  const labels: QrPrintLabel[] = [];

  for (let i = 0; i < entries.length; i += PDC_LOOKUP_CONCURRENCY) {
    const batch = entries.slice(i, i + PDC_LOOKUP_CONCURRENCY);
    labels.push(
      ...(await Promise.all(batch.map((entry) => buildLabel(entry.id, entry.category)))),
    );
  }

  return labels;
}
