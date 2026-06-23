import "server-only";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  ProductCategory,
  RoomPreviewProduct,
  TargetSurface,
  ProductType,
} from "@/lib/room-preview/types";

const ALLOWED_PRODUCT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * Explicit folder → classification map. The product category is decided by the
 * subfolder the image lives in — NEVER by the product-code prefix and never by
 * inspecting the image. Add a new entry here to support a new category folder.
 */
type CategoryDir = {
  dir: string;
  category: ProductCategory;
  targetSurface: TargetSurface;
  productType: ProductType;
};

const CATEGORY_DIRS: readonly CategoryDir[] = [
  { dir: "parquet", category: "PARQUET", targetSurface: "floor", productType: "floor_material" },
  { dir: "wallpaper", category: "WALLPAPER", targetSurface: "walls", productType: "wall_material" },
];

/** Legacy classification for any loose files left directly under qr-products/. */
const LEGACY_CLASSIFICATION: Omit<CategoryDir, "dir"> = {
  category: "PARQUET",
  targetSurface: "floor",
  productType: "floor_material",
};

function getQrProductsRoot() {
  return path.join(process.cwd(), "public", "qr-products");
}

function publicAssetPath(...segments: string[]) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/** Find a file in `absDir` whose name (without extension) equals `productCode`. */
function findImageFileInDir(absDir: string, productCode: string): string | null {
  if (!existsSync(absDir)) return null;

  const files = readdirSync(absDir, { withFileTypes: true })
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

/**
 * Locate a QR product image by code across the category subfolders, then fall
 * back to any legacy loose file directly under qr-products/ (classified as
 * PARQUET so old links keep working). Returns the matched file's relative path
 * segments and its classification, or null if nothing matched.
 */
function findQrProductImage(productCode: string): {
  segments: string[];
  classification: Omit<CategoryDir, "dir">;
} | null {
  const root = getQrProductsRoot();

  for (const entry of CATEGORY_DIRS) {
    const fileName = findImageFileInDir(path.join(root, entry.dir), productCode);
    if (fileName) {
      return {
        segments: ["qr-products", entry.dir, fileName],
        classification: entry,
      };
    }
  }

  const legacyFile = findImageFileInDir(root, productCode);
  if (legacyFile) {
    return {
      segments: ["qr-products", legacyFile],
      classification: LEGACY_CLASSIFICATION,
    };
  }

  return null;
}

/**
 * @deprecated Use {@link getQrProductByCode}. Retained for callers that only
 * need the bare file name from the (legacy) flat layout.
 */
export function findQrProductImageFile(productCode: string): string | null {
  const found = findQrProductImage(productCode);
  if (!found) return null;
  return found.segments[found.segments.length - 1];
}

export function getQrProductByCode(productCode: string): RoomPreviewProduct | null {
  const found = findQrProductImage(productCode);
  if (!found) return null;

  const { classification, segments } = found;

  return {
    id: productCode,
    barcode: productCode,
    name: productCode,
    productType: classification.productType,
    category: classification.category,
    targetSurface: classification.targetSurface,
    imageUrl: publicAssetPath(...segments),
  };
}

/**
 * List every QR product across all category subfolders (and any legacy loose
 * files). Used by the QR print page. The product code is the file name without
 * its extension.
 */
export function listQrProducts(): RoomPreviewProduct[] {
  const root = getQrProductsRoot();
  const products: RoomPreviewProduct[] = [];
  const seen = new Set<string>();

  const addFromDir = (absDir: string, segPrefix: string[], classification: Omit<CategoryDir, "dir">) => {
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const parsed = path.parse(entry.name);
      if (!ALLOWED_PRODUCT_EXTENSIONS.includes(parsed.ext.toLowerCase())) continue;
      const code = parsed.name;
      if (seen.has(code)) continue;
      seen.add(code);
      products.push({
        id: code,
        barcode: code,
        name: code,
        productType: classification.productType,
        category: classification.category,
        targetSurface: classification.targetSurface,
        imageUrl: publicAssetPath(...segPrefix, entry.name),
      });
    }
  };

  for (const entry of CATEGORY_DIRS) {
    addFromDir(path.join(root, entry.dir), ["qr-products", entry.dir], entry);
  }
  // Legacy loose files (classified PARQUET) — only those not already seen.
  addFromDir(root, ["qr-products"], LEGACY_CLASSIFICATION);

  return products.sort((a, b) => a.id.localeCompare(b.id));
}
