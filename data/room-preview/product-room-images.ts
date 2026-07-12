import "server-only";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const PRODUCT_CODE_PATTERN = /([A-Z]{2,}\d{3}\.\d{3})/i;
const IMAGE_FILE_PATTERN = /\.(?:jpe?g|png|webp)$/i;
const PRODUCT_ONLY_IMAGE_PATTERN = /^p\.(?:jpe?g|png|webp)$/i;

function getProductRoot() {
  return path.join(process.cwd(), "public", "product");
}

function getProductCode(folderName: string) {
  return folderName.match(PRODUCT_CODE_PATTERN)?.[1]?.toUpperCase() ?? folderName;
}

function toPublicProductUrl(folderName: string, fileName: string) {
  return `/product/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`;
}

// Fixed 8-image homepage carousel: 4 curated Parquet + 4 curated Carpet
// codes, interleaved so no two of the same flooring type are ever adjacent
// in the ring. Folder discovery below is unchanged — this only selects and
// orders the final result.
const CAROUSEL_ORDER = [
  "PQC301.002", // parquet — honey SPC
  "PQA200.001", // carpet — Streamline 578
  "PQH090.051", // parquet — warm laminate
  "PQD200.001", // carpet — Gleam 511
  "PQH111.013", // parquet — grey flat parquet
  "PQH111.100", // carpet — Mezzo 672
  "PQH111.301", // parquet — chateau laminate
  "PQH100.001", // carpet — Litho 208
];

export function getRoomPreviewProductRoomImages() {
  const productRoot = getProductRoot();
  if (!existsSync(productRoot)) return [];

  const items = readdirSync(productRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folderName = entry.name;
      const folderPath = path.join(productRoot, folderName);
      const roomImage = readdirSync(folderPath, { withFileTypes: true })
        .filter((file) => file.isFile())
        .map((file) => file.name)
        .filter((fileName) => IMAGE_FILE_PATTERN.test(fileName))
        .find((fileName) => !PRODUCT_ONLY_IMAGE_PATTERN.test(fileName));

      if (!roomImage) return null;

      return {
        code: getProductCode(folderName),
        imageUrl: toPublicProductUrl(folderName, roomImage),
      };
    })
    .filter((item): item is { code: string; imageUrl: string } => item !== null);

  const imageUrlByCode = new Map(items.map((item) => [item.code, item.imageUrl]));

  return CAROUSEL_ORDER.map((code) => imageUrlByCode.get(code)).filter(
    (imageUrl): imageUrl is string => Boolean(imageUrl),
  );
}
