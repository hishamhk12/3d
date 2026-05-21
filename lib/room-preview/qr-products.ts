import "server-only";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

const ALLOWED_PRODUCT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function getQrProductsRoot() {
  return path.join(process.cwd(), "public", "qr-products");
}

function publicAssetPath(...segments: string[]) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export function findQrProductImageFile(productCode: string) {
  const productsRoot = getQrProductsRoot();
  if (!existsSync(productsRoot)) return null;

  const files = readdirSync(productsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const extension of ALLOWED_PRODUCT_EXTENSIONS) {
    const match = files.find((fileName) => {
      const parsed = path.parse(fileName);
      return parsed.name === productCode && parsed.ext.toLowerCase() === extension;
    });

    if (match) return match;
  }

  return null;
}

export function getQrProductByCode(productCode: string): RoomPreviewProduct | null {
  const fileName = findQrProductImageFile(productCode);
  if (!fileName) return null;

  return {
    id: productCode,
    barcode: productCode,
    name: productCode,
    productType: "floor_material",
    imageUrl: publicAssetPath("qr-products", fileName),
  };
}
