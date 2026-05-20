import "server-only";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { MockRoomPreviewProduct } from "@/lib/room-preview/types";

const PRODUCT_CODE_PATTERN = /([A-Z]{2,}\d{3}\.\d{3})/i;
const PRODUCT_IMAGE_PATTERN = /^p\.(?:jpe?g|png|webp)$/i;

function getProductRoot() {
  return path.join(process.cwd(), "public", "product");
}

function getProductCode(folderName: string) {
  return folderName.match(PRODUCT_CODE_PATTERN)?.[1]?.toUpperCase() ?? null;
}

function getProductName(folderName: string, code: string | null) {
  if (!code) return folderName.trim();

  const codeIndex = folderName.toUpperCase().indexOf(code);
  const name = codeIndex >= 0
    ? folderName.slice(codeIndex + code.length).replace(/\s+/gu, " ").trim()
    : "";

  return name || folderName.trim();
}

function getProductBarcode(code: string | null) {
  return code ? code.replace(/[^A-Z0-9]/gi, "").toUpperCase() : null;
}

function toPublicProductUrl(folderName: string, fileName: string) {
  return `/product/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`;
}

function readProductsFromPublicFolder(): MockRoomPreviewProduct[] {
  const productRoot = getProductRoot();
  if (!existsSync(productRoot)) return [];

  return readdirSync(productRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry, index) => {
      const folderName = entry.name;
      const folderPath = path.join(productRoot, folderName);
      const productImage = readdirSync(folderPath, { withFileTypes: true })
        .filter((file) => file.isFile())
        .map((file) => file.name)
        .find((fileName) => PRODUCT_IMAGE_PATTERN.test(fileName));

      if (!productImage) return null;

      const code = getProductCode(folderName);

      return {
        id: code ?? `product-${index + 1}`,
        barcode: getProductBarcode(code),
        name: getProductName(folderName, code),
        productType: "floor_material",
        imageUrl: toPublicProductUrl(folderName, productImage),
      } satisfies MockRoomPreviewProduct;
    })
    .filter((product): product is MockRoomPreviewProduct => product !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getRoomPreviewMockProducts(): MockRoomPreviewProduct[] {
  return readProductsFromPublicFolder();
}

export function getRoomPreviewMockProductById(productId: string) {
  return getRoomPreviewMockProducts().find((p) => p.id === productId) ?? null;
}

export function getRoomPreviewMockProductByBarcode(barcode: string) {
  const normalizedBarcode = barcode.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return getRoomPreviewMockProducts().find((p) => p.barcode === normalizedBarcode) ?? null;
}
