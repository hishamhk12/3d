/**
 * Client-side image compression for room photo uploads.
 *
 * Uses the Canvas API — browser only, never import from server code.
 *
 * Strategy:
 *  - Cap the longest side at 1920 px (maintains aspect ratio)
 *  - Re-encode as JPEG at 82% quality
 *  - Skip entirely if the file is already under 1 MB (not worth the CPU)
 *  - If compression somehow produces a larger file, return the original
 *  - On any error (canvas unavailable, corrupt image), return the original
 *    so the upload can still proceed
 */

const MAX_DIMENSION_PX = 1920;
const JPEG_QUALITY = 0.82;
/** Files smaller than this are already small enough — skip compression. */
const SKIP_BELOW_BYTES = 1 * 1024 * 1024; // 1 MB

export async function compressRoomImage(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // corrupt / unsupported format — send original
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // ── Scale down to MAX_DIMENSION on the longest side ──────────────────
      let { naturalWidth: w, naturalHeight: h } = img;

      if (w > MAX_DIMENSION_PX || h > MAX_DIMENSION_PX) {
        if (w >= h) {
          h = Math.round((h * MAX_DIMENSION_PX) / w);
          w = MAX_DIMENSION_PX;
        } else {
          w = Math.round((w * MAX_DIMENSION_PX) / h);
          h = MAX_DIMENSION_PX;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file); // canvas unavailable
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file); // no gain — send original
            return;
          }

          // Keep the same base name but force .jpg extension so the server
          // receives a consistent MIME type.
          const compressedName = file.name.replace(/\.[^.]+$/, ".jpg");
          resolve(new File([blob], compressedName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };

    img.src = objectUrl;
  });
}
