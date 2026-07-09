import "server-only";

import { getLogger } from "@/lib/logger";

const log = getLogger("pdc-client");

/** PDC responds slowly after Render.com cold starts; fail before the mobile UI feels hung. */
const PDC_REQUEST_TIMEOUT_MS = 8_000;
const PDC_CACHE_TTL_MS = 5 * 60 * 1_000;

export type PdcErrorKind = "bad_request" | "auth" | "not_found" | "unavailable";

export class PdcError extends Error {
  readonly kind: PdcErrorKind;
  readonly status: number | null;

  constructor(kind: PdcErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "PdcError";
    this.kind = kind;
    this.status = status;
  }
}

export function isPdcError(error: unknown): error is PdcError {
  return error instanceof PdcError;
}

export type PdcProductImage = {
  type: string;
  url: string;
  width?: number | null;
  height?: number | null;
};

export type PdcProductResponse = {
  sku: string;
  product_name_ar: string;
  product_name_en: string;
  ecommerce_url: string | null;
  pdc_page_url: string | null;
  images: PdcProductImage[];
};

type CacheEntry = {
  product: PdcProductResponse;
  expiresAt: number;
};

const productCache = new Map<string, CacheEntry>();

/** Test-only escape hatch: the module-level cache would leak state between tests. */
export function clearPdcProductCache() {
  productCache.clear();
}

function getPdcConfig() {
  const baseUrl = process.env.PDC_API_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.PDC_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    log.error(
      { hasBaseUrl: Boolean(baseUrl), hasApiKey: Boolean(apiKey) },
      "PDC configuration missing — set PDC_API_BASE_URL and PDC_API_KEY",
    );
    throw new PdcError("auth", "PDC API is not configured.");
  }

  return { baseUrl, apiKey };
}

/**
 * Fetch a product from the PDC External Product API by SKU.
 *
 * The SKU is sent exactly as provided — PDC treats SKUs as case-sensitive, so
 * callers must never change its casing. The API key never appears in thrown
 * errors or log payloads.
 */
export async function fetchPdcProduct(sku: string): Promise<PdcProductResponse> {
  const cached = productCache.get(sku);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.product;
  }

  const { baseUrl, apiKey } = getPdcConfig();
  const url = `${baseUrl}/product/?sku=${encodeURIComponent(sku)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PDC_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    log.error({ sku, isTimeout }, "PDC request failed before a response was received");
    throw new PdcError(
      "unavailable",
      isTimeout ? "PDC API timed out." : "PDC API is unreachable.",
    );
  }

  if (!response.ok) {
    // Read PDC's { error } body for logs only — it must never reach the client.
    const errorBody = await response.text().catch(() => "");
    log.warn({ sku, status: response.status, errorBody }, "PDC returned an error response");

    switch (response.status) {
      case 400:
        throw new PdcError("bad_request", "PDC rejected the SKU.", 400);
      case 401:
      case 403:
        throw new PdcError("auth", "PDC rejected our credentials.", response.status);
      case 404:
        throw new PdcError("not_found", `Product with SKU "${sku}" was not found.`, 404);
      default:
        throw new PdcError("unavailable", "PDC API returned an unexpected error.", response.status);
    }
  }

  let product: PdcProductResponse;
  try {
    product = (await response.json()) as PdcProductResponse;
  } catch {
    log.error({ sku }, "PDC returned unparseable JSON");
    throw new PdcError("unavailable", "PDC API returned an invalid response.");
  }

  productCache.set(sku, { product, expiresAt: Date.now() + PDC_CACHE_TTL_MS });
  return product;
}
