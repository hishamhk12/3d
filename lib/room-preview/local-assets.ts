import "server-only";

import { readdirSync } from "node:fs";
import path from "node:path";

const ROOM_PREVIEW_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ROOM_PREVIEW_TEST_ASSETS_DIRECTORY = path.join(process.cwd(), "public", "test-assets");
const ROOM_PREVIEW_UPLOADS_DIRECTORY = path.join(process.cwd(), "public", "uploads");

const ROOM_PREVIEW_ASSET_DIRECTORIES = new Map([
  ["test-assets/rooms", path.join(ROOM_PREVIEW_TEST_ASSETS_DIRECTORY, "rooms")],
]);

const ROOM_PREVIEW_LOCAL_ASSET_SCOPES = [
  {
    directory: ROOM_PREVIEW_UPLOADS_DIRECTORY,
    prefixSegments: ["uploads"],
  },
  {
    directory: ROOM_PREVIEW_TEST_ASSETS_DIRECTORY,
    prefixSegments: ["test-assets"],
  },
];

function isImageFile(fileName: string) {
  return ROOM_PREVIEW_IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function slugifyFileName(fileName: string) {
  return path
    .parse(fileName)
    .name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanizeFileName(fileName: string) {
  const rawName = path.parse(fileName).name;

  return rawName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPublicAssetUrl(...segments: string[]) {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export function getRoomPreviewAssetFiles(directorySegments: string[]) {
  const directoryKey = directorySegments.join("/");
  const absoluteDirectory = ROOM_PREVIEW_ASSET_DIRECTORIES.get(directoryKey);

  if (!absoluteDirectory) {
    return [];
  }

  try {
    return readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        fileName: entry.name,
        id: slugifyFileName(entry.name),
        imageUrl: buildPublicAssetUrl(...directorySegments, entry.name),
        name: humanizeFileName(entry.name),
      }));
  } catch {
    return [];
  }
}

export function getRoomPreviewPublicAssetPath(publicAssetUrl: string) {
  const assetPathname = publicAssetUrl.split("?")[0]?.split("#")[0] ?? "";

  if (!assetPathname.startsWith("/")) {
    throw new Error("A public asset URL must start with '/'.");
  }

  const assetSegments = assetPathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  const scope = ROOM_PREVIEW_LOCAL_ASSET_SCOPES.find(({ prefixSegments }) =>
    prefixSegments.every((segment, index) => assetSegments[index] === segment),
  );

  if (!scope) {
    throw new Error("Unsupported local room preview asset path.");
  }

  const scopedSegments = assetSegments.slice(scope.prefixSegments.length);
  const absoluteAssetPath = path.join(scope.directory, ...scopedSegments);
  const relativeAssetPath = path.relative(scope.directory, absoluteAssetPath);

  if (relativeAssetPath.startsWith("..") || path.isAbsolute(relativeAssetPath)) {
    throw new Error("Resolved asset path is outside the allowed public asset directory.");
  }

  return absoluteAssetPath;
}
