import fs from "node:fs";
import path from "node:path";

const projectDir = process.cwd();
const productsRoot = path.join(projectDir, "public", "qr-products");
const outputFile = path.join(projectDir, "data", "room-preview", "qr-product-manifest.ts");
const wallCladdingAllowlistFile = path.join(
  projectDir,
  "data",
  "room-preview",
  "wall-cladding-sku-allowlist.json",
);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// NOTE: keep this list in sync with every category folder actually referenced
// by data/room-preview/qr-product-manifest.ts. A category missing here used to
// mean a silent, destructive rewrite (see loadExistingEntriesByCategory below
// for why that is now prevented instead of just documented).
const categories = [
  {
    dir: "parquet",
    category: "PARQUET",
    targetSurface: "floor",
    productType: "floor_material",
  },
  {
    dir: "wallpaper",
    category: "WALLPAPER",
    targetSurface: "walls",
    productType: "wall_material",
  },
  {
    dir: "carpet-tile",
    category: "CARPET_TILE",
    targetSurface: "floor",
    productType: "floor_material",
  },
  {
    dir: "wall-cladding",
    category: "WALL_CLADDING",
    targetSurface: "walls",
    productType: "wall_cladding",
  },
];

function publicAssetPath(...segments) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function listProductFiles(absDir) {
  if (!fs.existsSync(absDir)) return [];
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Load the WALL_CLADDING SKU → availability ("regular" | "clearance") map
 * from the single central allowlist file (also read by
 * lib/room-preview/wall-cladding-catalog.ts on the TypeScript side). Returns
 * an empty map if the file is missing so this script never hard-fails.
 */
function loadWallCladdingAvailability() {
  if (!fs.existsSync(wallCladdingAllowlistFile)) return new Map();
  const raw = JSON.parse(fs.readFileSync(wallCladdingAllowlistFile, "utf8"));
  return new Map(Object.entries(raw).map(([code, availability]) => [code.toUpperCase(), availability]));
}

/**
 * Parse the manifest file THIS SCRIPT PREVIOUSLY GENERATED back into entries,
 * grouped by category. Used only as a fallback for a category whose image
 * folder does not exist on disk right now (e.g. CARPET_TILE / WALL_CLADDING
 * products currently served from PDC in production, with no local image
 * files vendored into this checkout yet).
 *
 * Why this exists: before this fix, a category absent from `categories`
 * above (or present but with an empty/missing folder) silently produced ZERO
 * entries for that category on every regenerate — which is exactly how
 * CARPET_TILE entries were added by hand in the past while this script
 * stayed unaware of them. Re-running the script would have silently deleted
 * every CARPET_TILE (and, without this fix, every WALL_CLADDING) entry. This
 * function preserves whatever entries already exist for a category instead
 * of ever silently dropping them.
 */
function loadExistingEntriesByCategory() {
  const byCategory = new Map();
  if (!fs.existsSync(outputFile)) return byCategory;

  const text = fs.readFileSync(outputFile, "utf8");
  for (const match of text.matchAll(/^\s*(\{.*\}),?\s*$/gm)) {
    let entry;
    try {
      entry = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (!entry || typeof entry.category !== "string") continue;
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }
  return byCategory;
}

const wallCladdingAvailability = loadWallCladdingAvailability();
const existingEntriesByCategory = loadExistingEntriesByCategory();

const entries = [];
const seenCodes = new Map();

for (const config of categories) {
  const absDir = path.join(productsRoot, config.dir);
  const files = listProductFiles(absDir);

  if (files.length === 0) {
    // No local image folder (or it's empty) for this category — never wipe
    // out entries this category already had. This is expected today for
    // CARPET_TILE and WALL_CLADDING, whose product images are resolved from
    // PDC in production and are not vendored locally.
    const preserved = existingEntriesByCategory.get(config.category) ?? [];
    for (const entry of preserved) {
      if (seenCodes.has(entry.code)) {
        throw new Error(`Duplicate QR product code "${entry.code}" while preserving ${config.category}`);
      }
      seenCodes.set(entry.code, `preserved:${config.category}`);
      entries.push(entry);
    }
    if (preserved.length > 0) {
      console.warn(
        `No local images found for "${config.dir}" — preserved ${preserved.length} existing ${config.category} entries unchanged.`,
      );
    }
    continue;
  }

  for (const fileName of files) {
    const parsed = path.parse(fileName);
    const extension = parsed.ext.toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new Error(`Unsupported QR product extension: ${path.join(config.dir, fileName)}`);
    }

    const code = parsed.name;
    const previous = seenCodes.get(code);
    if (previous) {
      throw new Error(`Duplicate QR product code "${code}" in ${previous} and ${path.join(config.dir, fileName)}`);
    }

    seenCodes.set(code, path.join(config.dir, fileName));
    const availability =
      config.category === "WALL_CLADDING" ? wallCladdingAvailability.get(code.toUpperCase()) : undefined;

    entries.push({
      code,
      category: config.category,
      targetSurface: config.targetSurface,
      productType: config.productType,
      imageUrl: publicAssetPath("qr-products", config.dir, fileName),
      ...(availability ? { availability } : {}),
    });
  }
}

const lines = [
  "import type { ProductAvailability, ProductCategory, ProductType, TargetSurface } from \"@/lib/room-preview/types\";",
  "",
  "export type QrProductManifestEntry = {",
  "  code: string;",
  "  category: ProductCategory;",
  "  targetSurface: TargetSurface;",
  "  productType: ProductType;",
  "  imageUrl: string;",
  "  availability?: ProductAvailability;",
  "};",
  "",
  "// Generated by scripts/generate-qr-product-manifest.mjs.",
  "// Runtime code must read this lightweight manifest instead of scanning public/qr-products.",
  "export const QR_PRODUCT_MANIFEST = [",
  ...entries.map((entry) => `  ${JSON.stringify(entry)},`),
  "] as const satisfies readonly QrProductManifestEntry[];",
  "",
];

fs.writeFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
console.log(`Generated ${entries.length} QR products -> ${path.relative(projectDir, outputFile)}`);
