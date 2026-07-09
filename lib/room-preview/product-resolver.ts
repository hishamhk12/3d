import "server-only";

import { getLogger } from "@/lib/logger";
import { fetchPdcProduct, isPdcError } from "@/lib/room-preview/pdc-client";
import {
  classifySkuCategory,
  mapPdcResponseToProduct,
  PdcProductImageMissingError,
} from "@/lib/room-preview/pdc-product";
import { isValidProductCode } from "@/lib/room-preview/product-qr";
import { getQrProductByCode } from "@/lib/room-preview/qr-products";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

const log = getLogger("product-resolver");

export type ResolveProductErrorCode =
  | "INVALID_SKU"
  | "UNSUPPORTED_PRODUCT_CATEGORY"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_IMAGE_MISSING"
  | "PDC_AUTH_ERROR"
  | "PDC_UNAVAILABLE";

export type ResolveProductResult =
  | { ok: true; product: RoomPreviewProduct }
  | { ok: false; code: ResolveProductErrorCode; status: number; error: string };

function failure(code: ResolveProductErrorCode, status: number, error: string): ResolveProductResult {
  return { ok: false, code, status, error };
}

/**
 * Resolve a scanned product code / SKU to a product.
 *
 * PDC is the primary source. The local QR manifest is a development-only
 * fallback so the flow keeps working without PDC credentials; in production a
 * PDC failure surfaces as an error. The SKU is forwarded to PDC exactly as
 * received — PDC SKUs are case-sensitive.
 */
export async function resolveProductByCode(code: string): Promise<ResolveProductResult> {
  const sku = code.trim();

  if (!sku || !isValidProductCode(sku)) {
    return failure("INVALID_SKU", 400, "A valid product code is required.");
  }

  const classification = classifySkuCategory(sku);
  if (!classification) {
    return failure(
      "UNSUPPORTED_PRODUCT_CATEGORY",
      422,
      "This product category is not supported in room preview yet.",
    );
  }

  try {
    const response = await fetchPdcProduct(sku);
    return { ok: true, product: mapPdcResponseToProduct(response, classification) };
  } catch (error) {
    if (error instanceof PdcProductImageMissingError) {
      log.warn({ sku }, "PDC product has no usable image");
      return failure("PRODUCT_IMAGE_MISSING", 404, "This product has no preview image yet.");
    }

    if (!isPdcError(error)) {
      log.error({ err: error, sku }, "Unexpected failure while resolving product from PDC");
      return failure("PDC_UNAVAILABLE", 502, "Product lookup failed. Please try again.");
    }

    // Development-only fallback: any PDC failure (missing config included)
    // falls back to the bundled QR manifest so local work never needs PDC.
    if (process.env.NODE_ENV === "development") {
      const localProduct = getQrProductByCode(sku);
      if (localProduct) {
        log.info({ sku, pdcErrorKind: error.kind }, "PDC unavailable — using local manifest fallback");
        return { ok: true, product: { ...localProduct, source: "local" } };
      }
    }

    switch (error.kind) {
      case "not_found":
        return failure("PRODUCT_NOT_FOUND", 404, "Product was not found.");
      case "bad_request":
        return failure("INVALID_SKU", 400, "PDC rejected this product code.");
      case "auth":
        // Our configuration problem, not the customer's — details stay in logs.
        return failure("PDC_AUTH_ERROR", 500, "Product lookup is temporarily unavailable.");
      case "unavailable":
      default:
        return failure("PDC_UNAVAILABLE", 502, "Product lookup failed. Please try again.");
    }
  }
}
