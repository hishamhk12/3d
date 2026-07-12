import "server-only";

import { QR_PRODUCT_MANIFEST } from "@/data/room-preview/qr-product-manifest";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

type QrProductManifestProduct = (typeof QR_PRODUCT_MANIFEST)[number];

const PRODUCTS_BY_CODE = new Map<string, QrProductManifestProduct>(
  QR_PRODUCT_MANIFEST.map((product) => [product.code, product]),
);

function toRoomPreviewProduct(product: QrProductManifestProduct): RoomPreviewProduct {
  return {
    id: product.code,
    barcode: product.code,
    name: product.code,
    productType: product.productType,
    category: product.category,
    targetSurface: product.targetSurface,
    imageUrl: product.imageUrl,
    ...("availability" in product && product.availability ? { availability: product.availability } : {}),
  };
}

/**
 * @deprecated Use {@link getQrProductByCode}. Retained for callers that only
 * need the bare file name from the product image URL.
 */
export function findQrProductImageFile(productCode: string): string | null {
  const product = PRODUCTS_BY_CODE.get(productCode);
  if (!product) return null;
  return product.imageUrl.split("/").pop() ?? null;
}

export function getQrProductByCode(productCode: string): RoomPreviewProduct | null {
  const product = PRODUCTS_BY_CODE.get(productCode);
  if (!product) return null;
  return toRoomPreviewProduct(product);
}

export function listQrProducts(): RoomPreviewProduct[] {
  return QR_PRODUCT_MANIFEST.map(toRoomPreviewProduct).sort((a, b) => a.id.localeCompare(b.id));
}
