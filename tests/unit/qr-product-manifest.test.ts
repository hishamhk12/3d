import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { QR_PRODUCT_MANIFEST } from "@/data/room-preview/qr-product-manifest";
import type { QrProductManifestEntry } from "@/data/room-preview/qr-product-manifest";
import wallCladdingAllowlist from "@/data/room-preview/wall-cladding-sku-allowlist.json";

// Widened view of the manifest: QR_PRODUCT_MANIFEST is `as const`, so each
// element keeps its own narrow literal type (only listing the keys that
// entry actually has). Widening to QrProductManifestEntry[] here lets these
// tests read the optional `availability` field uniformly across entries,
// without changing the generator's own `as const` output.
const MANIFEST: readonly QrProductManifestEntry[] = QR_PRODUCT_MANIFEST;

const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const categoryDirs = [
  { dir: "parquet", category: "PARQUET" },
  { dir: "wallpaper", category: "WALLPAPER" },
] as const;

// Codes requested for the CRP carpet-tile rollout. Unlike PARQUET/WALLPAPER,
// these are manually curated (PDC-only, no bundled local image) rather than
// scanned from public/qr-products/** by the generator script.
const CARPET_TILE_CODES = [
  "CRPT050.001",
  "CRPT050.006",
  "CRPT050.007",
  "CRPT050.009",
  "CRPT050.051",
  "CRPT050.056",
  "CRPT050.057",
  "CRPT050.058",
  "CRPT060.001",
  "CRPT060.002",
  "CRPT060.004",
  "CRPT060.006",
  "CRPT060.007",
  "CRPT060.008",
  "CRPT060.010",
  "CRPT060.011",
  "CRPT060.015",
  "CRPT060.018",
  "CRPT060.025",
  "CRPT060.026",
  "CRPT060.027",
  "CRPT060.061",
  "CRPT060.062",
  "CRPT060.063",
  "CRPT060.100",
  "CRPT060.105",
  "CRPT060.202",
  "CRPT060.203",
  "CRPT060.204",
  "CRPT060.303",
] as const;

function normalizePublicUrl(filePath: string) {
  return `/${filePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

describe("QR product manifest", () => {
  it("has one unique code across the whole manifest", () => {
    const seen = new Set<string>();
    for (const product of QR_PRODUCT_MANIFEST) {
      expect(seen.has(product.code)).toBe(false);
      seen.add(product.code);
    }
  });

  it("contains one generator-produced entry for every local PARQUET/WALLPAPER image", () => {
    const generatedEntries = QR_PRODUCT_MANIFEST.filter(
      (p) => p.category === "PARQUET" || p.category === "WALLPAPER",
    );
    const manifestByCode = new Map<string, (typeof generatedEntries)[number]>(
      generatedEntries.map((p) => [p.code, p]),
    );

    for (const product of generatedEntries) {
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

    expect(generatedEntries).toHaveLength(imageFiles.length);

    for (const file of imageFiles) {
      const manifestEntry = manifestByCode.get(file.code);
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry?.category).toBe(file.category);
      expect(manifestEntry?.imageUrl).toBe(file.imageUrl);
    }
  });

  it("includes every requested CRPT050 / CRPT060 carpet-tile code", () => {
    const manifestCodes = new Set(QR_PRODUCT_MANIFEST.map((p) => p.code));
    for (const code of CARPET_TILE_CODES) {
      expect(manifestCodes.has(code)).toBe(true);
    }
    expect(CARPET_TILE_CODES).toHaveLength(30);
  });

  it("classifies every carpet-tile manifest entry as CARPET_TILE / floor / floor_material", () => {
    for (const code of CARPET_TILE_CODES) {
      const entry = QR_PRODUCT_MANIFEST.find((p) => p.code === code);
      expect(entry).toBeDefined();
      expect(entry?.category).toBe("CARPET_TILE");
      expect(entry?.targetSurface).toBe("floor");
      expect(entry?.productType).toBe("floor_material");
    }
  });

  describe("WALL_CLADDING rollout", () => {
    const allowlistCodes = Object.keys(wallCladdingAllowlist);

    it("includes every allowlisted WALL_CLADDING code, and nothing extra", () => {
      const manifestWallCladdingCodes: Set<string> = new Set(
        MANIFEST.filter((p) => p.category === "WALL_CLADDING").map((p) => p.code),
      );
      expect(manifestWallCladdingCodes.size).toBe(allowlistCodes.length);
      for (const code of allowlistCodes) {
        expect(manifestWallCladdingCodes.has(code)).toBe(true);
      }
    });

    it("has exactly 50 approved WALL_CLADDING codes (30 regular + 20 clearance)", () => {
      expect(allowlistCodes).toHaveLength(50);
      const regular = Object.values(wallCladdingAllowlist).filter((v) => v === "regular");
      const clearance = Object.values(wallCladdingAllowlist).filter((v) => v === "clearance");
      expect(regular).toHaveLength(30);
      expect(clearance).toHaveLength(20);
    });

    it("classifies every WALL_CLADDING manifest entry as WALL_CLADDING / walls / wall_cladding", () => {
      for (const code of allowlistCodes) {
        const entry = MANIFEST.find((p) => p.code === code);
        expect(entry).toBeDefined();
        expect(entry?.category).toBe("WALL_CLADDING");
        expect(entry?.targetSurface).toBe("walls");
        expect(entry?.productType).toBe("wall_cladding");
      }
    });

    it("carries the correct availability (regular/clearance) from the central allowlist onto each entry", () => {
      for (const [code, availability] of Object.entries(wallCladdingAllowlist)) {
        const entry = MANIFEST.find((p) => p.code === code);
        expect(entry?.availability).toBe(availability);
      }
    });

    it("every WALL_CLADDING imageUrl points under /qr-products/wall-cladding/", () => {
      for (const code of allowlistCodes) {
        const entry = MANIFEST.find((p) => p.code === code);
        expect(entry?.imageUrl).toBe(`/qr-products/wall-cladding/${code}.jpg`);
      }
    });
  });

  it("has no duplicate codes across PARQUET/WALLPAPER/CARPET_TILE/WALL_CLADDING combined", () => {
    const byCategory = new Map<string, string>();
    for (const product of QR_PRODUCT_MANIFEST) {
      const previous = byCategory.get(product.code);
      expect(previous).toBeUndefined();
      byCategory.set(product.code, product.category);
    }
  });
});
