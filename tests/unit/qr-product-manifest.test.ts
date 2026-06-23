import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { QR_PRODUCT_MANIFEST } from "@/data/room-preview/qr-product-manifest";

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const categoryDirs = [
  { dir: "parquet", category: "PARQUET" },
  { dir: "wallpaper", category: "WALLPAPER" },
] as const;

function normalizePublicUrl(filePath: string) {
  return `/${filePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

describe("QR product manifest", () => {
  it("contains one unique entry for every supported QR product image", () => {
    const manifestByCode = new Map<string, (typeof QR_PRODUCT_MANIFEST)[number]>();

    for (const product of QR_PRODUCT_MANIFEST) {
      expect(manifestByCode.has(product.code)).toBe(false);
      manifestByCode.set(product.code, product);

      expect(allowedExtensions.has(path.extname(product.imageUrl).toLowerCase())).toBe(true);
      expect(product.imageUrl.startsWith("/qr-products/")).toBe(true);

      const absImagePath = path.join(process.cwd(), "public", ...product.imageUrl.split("/").filter(Boolean));
      expect(fs.existsSync(absImagePath)).toBe(true);
    }

    const imageFiles: Array<{ code: string; category: string; imageUrl: string }> = [];

    for (const categoryDir of categoryDirs) {
      const absDir = path.join(process.cwd(), "public", "qr-products", categoryDir.dir);
      for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        expect(allowedExtensions.has(ext)).toBe(true);

        imageFiles.push({
          code: path.parse(entry.name).name,
          category: categoryDir.category,
          imageUrl: normalizePublicUrl(path.join("qr-products", categoryDir.dir, entry.name)),
        });
      }
    }

    expect(QR_PRODUCT_MANIFEST).toHaveLength(imageFiles.length);

    for (const file of imageFiles) {
      const manifestEntry = manifestByCode.get(file.code);
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry?.category).toBe(file.category);
      expect(manifestEntry?.imageUrl).toBe(file.imageUrl);
    }
  });
});
