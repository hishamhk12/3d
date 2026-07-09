import "server-only";

import QRCode from "qrcode";
import { resolveProductByCode, type ResolveProductResult } from "@/lib/room-preview/product-resolver";
import { listQrProducts } from "@/lib/room-preview/qr-products";
import { getLogger } from "@/lib/logger";
import type { ProductCategory } from "@/lib/room-preview/types";

const log = getLogger("qr-print-labels");

export type QrPrintLabel = {
  productCode: string;
  category: ProductCategory;
  scanUrl: string;
  qrDataUrl: string;
  /** Product name from PDC; null when the product could not be resolved. */
  productName: string | null;
  /** Product image URL from PDC; null when the product could not be resolved. */
  productImageUrl: string | null;
  /** True when PDC could not resolve the product (no local image fallback — see module docs). */
  unavailable: boolean;
};

// ─── Concurrency & retry tuning ────────────────────────────────────────────────
//
// Audited against the live PDC API (2026-07): a batch of 8 concurrent SKU
// lookups against PDC's small Render.com instance produced a ~50-60% timeout
// rate; the SAME SKUs retried one at a time with a short pause between calls
// succeeded 100% of the time. This is why local dev looked fine (the
// dev-only local-manifest fallback below silently masked every timeout with
// a stale local image) while production — which correctly has no fallback —
// showed most WALLPAPER/CARPET_TILE cards as "unavailable" even though the
// underlying SKUs genuinely exist in PDC.
//
// Fix: lower concurrency AND retry once (short backoff) specifically on the
// "PDC_UNAVAILABLE" class of failure (timeouts / transient network errors).
// Never retry PRODUCT_NOT_FOUND, PDC_AUTH_ERROR, INVALID_SKU, or
// UNSUPPORTED_PRODUCT_CATEGORY — those are deterministic; retrying would only
// slow the page down for SKUs that are genuinely missing or misconfigured.
// Scoped entirely to this print-only path — resolveProductByCode itself, the
// live /scan flow, and PDC client/API-key handling are untouched.
const PDC_LOOKUP_CONCURRENCY = 4;
const PDC_RETRY_DELAY_MS = 400;

/** Fixed section/tab order — shared by the page's tabs nav and its grouped sections. */
export const QR_PRINT_CATEGORY_ORDER: readonly ProductCategory[] = [
  "PARQUET",
  "WALLPAPER",
  "CARPET_TILE",
];

const QR_PRINT_TAB_LABEL_AR: Record<ProductCategory, string> = {
  PARQUET: "باركيه",
  WALLPAPER: "ورق جدران",
  CARPET_TILE: "بلاطات موكيت",
};

export type QrPrintTabLink = {
  /** null = the "الكل" (all) tab. */
  category: ProductCategory | null;
  labelAr: string;
  href: string;
  active: boolean;
};

/**
 * Build the /qr-print category tabs — a plain, server-renderable list of
 * `{ href, active }` pairs consumed by <Link> in the page. Kept as a pure
 * function (no JSX) so the exact href/active-state contract is unit-testable
 * without rendering the async Server Component page.
 */
export function buildQrPrintTabLinks(activeCategory: ProductCategory | null): QrPrintTabLink[] {
  const allTab: QrPrintTabLink = {
    category: null,
    labelAr: "الكل",
    href: "/qr-print",
    active: activeCategory === null,
  };
  const categoryTabs = QR_PRINT_CATEGORY_ORDER.map((category) => ({
    category,
    labelAr: QR_PRINT_TAB_LABEL_AR[category],
    href: `/qr-print?category=${category}`,
    active: activeCategory === category,
  }));
  return [allTab, ...categoryTabs];
}

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

function unavailableLabel(productCode: string, category: ProductCategory, scanUrl: string, qrDataUrl: string): QrPrintLabel {
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a SKU with one retry, ONLY for the transient/"PDC_UNAVAILABLE"
 * failure class (see the concurrency/retry note above). A genuine
 * PRODUCT_NOT_FOUND, PDC_AUTH_ERROR, or invalid-SKU result returns
 * immediately — retrying those wastes time without changing the outcome.
 */
async function resolveWithRetry(productCode: string): Promise<ResolveProductResult> {
  const first = await resolveProductByCode(productCode);
  if (first.ok || first.code !== "PDC_UNAVAILABLE") {
    return first;
  }

  await sleep(PDC_RETRY_DELAY_MS);
  const retried = await resolveProductByCode(productCode);
  log.info(
    { productCode, firstAttempt: first.code, retryOk: retried.ok },
    "Retried a transient PDC failure for a print label",
  );
  return retried;
}

/**
 * Build one printable label. GUARANTEED to never reject: every SKU in the
 * manifest must always produce a card — PDC success, PDC failure, or any
 * other unexpected error all resolve to a label object here. A single bad
 * SKU must never take down its batch (Promise.all would otherwise reject the
 * whole batch) or abort the SKUs processed after it.
 */
async function buildLabel(productCode: string, category: ProductCategory): Promise<QrPrintLabel> {
  const scanUrl = buildScanUrl(productCode);

  try {
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 900,
    });

    // Product name/image come from PDC via the server-side resolver (the
    // resolver's development-only manifest fallback keeps local work possible
    // — never in production, and never surfaced as if it were PDC data).
    // On failure the label renders as unavailable — never a stale local image.
    const result = await resolveWithRetry(productCode);

    if (result.ok) {
      log.info({ productCode, category, pdcOk: true }, "qr_print_label_resolved");
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

    log.warn(
      { productCode, category, pdcOk: false, pdcErrorCode: result.code },
      "qr_print_label_resolved",
    );
    return unavailableLabel(productCode, category, scanUrl, qrDataUrl);
  } catch (error) {
    // resolveProductByCode is designed to never throw, and QR encoding of a
    // controlled ASCII URL essentially never fails — this catch is the last
    // line of defense so an unforeseen exception degrades to a single
    // unavailable card instead of silently dropping this SKU (and, via
    // Promise.all, every other SKU still queued in the same batch).
    log.error({ err: error, productCode }, "Unexpected failure while building a QR print label");
    return unavailableLabel(productCode, category, scanUrl, "");
  }
}

/**
 * Build the printable QR labels. The local manifest is used only as the list
 * of SKUs to print — all displayed product data is resolved server-side.
 *
 * When `category` is provided, the manifest is filtered to that category
 * BEFORE any PDC lookup runs — a category-scoped page (e.g. CARPET_TILE only)
 * never calls resolveProductByCode for the other categories' SKUs.
 *
 * Always returns exactly one label per matching manifest entry: PDC failures
 * (or any other per-SKU error) become `unavailable: true` cards, they never
 * remove the entry from the result. Promise.allSettled (rather than
 * Promise.all) is the outer guarantee that one entry's rejection can never
 * hide its batch-mates or abort the batches processed after it.
 *
 * Logs one aggregate summary (PDC ok / PDC unavailable / PDC not-found /
 * cards with an image / cards unavailable) so a real production run can be
 * checked in the Vercel logs without ever printing PDC credentials.
 */
export async function getQrPrintLabels(category?: ProductCategory | null): Promise<QrPrintLabel[]> {
  const entries = category
    ? listQrProducts().filter((entry) => entry.category === category)
    : listQrProducts();
  const labels: QrPrintLabel[] = [];

  for (let i = 0; i < entries.length; i += PDC_LOOKUP_CONCURRENCY) {
    const batch = entries.slice(i, i + PDC_LOOKUP_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((entry) => buildLabel(entry.id, entry.category)));

    settled.forEach((outcome, index) => {
      const entry = batch[index]!;
      if (outcome.status === "fulfilled") {
        labels.push(outcome.value);
        return;
      }
      // buildLabel already catches everything internally; this branch only
      // fires if something outside its own try/catch went wrong. Still: this
      // SKU gets an unavailable card, not a silent gap.
      log.error({ err: outcome.reason, productCode: entry.id }, "QR label build rejected unexpectedly");
      labels.push(unavailableLabel(entry.id, entry.category, buildScanUrl(entry.id), ""));
    });
  }

  const withImage = labels.filter((l) => !l.unavailable).length;
  const unavailableCount = labels.length - withImage;
  const byCategory = QR_PRINT_CATEGORY_ORDER.reduce<Record<string, { total: number; ok: number; unavailable: number }>>(
    (acc, c) => {
      const inCategory = labels.filter((l) => l.category === c);
      acc[c] = {
        total: inCategory.length,
        ok: inCategory.filter((l) => !l.unavailable).length,
        unavailable: inCategory.filter((l) => l.unavailable).length,
      };
      return acc;
    },
    {},
  );
  log.info(
    {
      event: "qr_print_labels_summary",
      categoryFilter: category ?? "all",
      totalSkus: labels.length,
      labelsWithImage: withImage,
      labelsUnavailable: unavailableCount,
      byCategory,
    },
    "qr_print_labels_summary",
  );

  return labels;
}

export type QrPrintCategoryGroup = {
  category: ProductCategory;
  labels: QrPrintLabel[];
};

/**
 * Group already-built labels into category sections for the page, in the
 * fixed PARQUET → WALLPAPER → CARPET_TILE order (QR_PRINT_CATEGORY_ORDER).
 *
 * When `activeCategory` is set, only that category's group is produced. A
 * category is dropped from the result ONLY when it truly has zero matching
 * labels (e.g. it was excluded by the `category` filter passed to
 * getQrPrintLabels) — a category with manifest entries always gets a group
 * here, whether every entry resolved from PDC or not: unavailable labels are
 * still labels, so they still count toward `labels.length > 0`.
 */
export function groupQrPrintLabelsByCategory(
  labels: QrPrintLabel[],
  activeCategory: ProductCategory | null,
): QrPrintCategoryGroup[] {
  return QR_PRINT_CATEGORY_ORDER.filter((c) => !activeCategory || c === activeCategory)
    .map((category) => ({
      category,
      labels: labels.filter((label) => label.category === category),
    }))
    .filter((group) => group.labels.length > 0);
}
