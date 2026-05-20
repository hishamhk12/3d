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

export function getRoomPreviewProductRoomImages() {
  const productRoot = getProductRoot();
  if (!existsSync(productRoot)) return [];

  return readdirSync(productRoot, { withFileTypes: true })
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
    .filter((item): item is { code: string; imageUrl: string } => item !== null)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((item) => item.imageUrl);
}
