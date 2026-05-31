/**
 * Client-side image compression for room photo uploads.
 *
 * Uses the Canvas API — browser only, never import from server code.
 *
 * Strategy:
 *  - Cap the longest side at 1024 px (maintains aspect ratio)
 *  - Re-encode as JPEG at 82% quality
 *  - Skip entirely if the file is already under 1 MB (not worth the CPU)
 *  - If compression somehow produces a larger file, return the original
 *  - On any error (canvas unavailable, corrupt image), return the original
 *    so the upload can still proceed
 *
 * The 1024 px / 0.82 target keeps the floor clearly visible while cutting the
 * upload payload (and therefore the Gemini round-trip) substantially. The
 * backend `sharp` resize + validation stays in place as a safety fallback — if
 * the client skips compression (small file, old browser, decode failure) the
 * server still normalises the image before it reaches Gemini.
 */

const MAX_DIMENSION_PX = 1024;
const JPEG_QUALITY = 0.82;
/** Files smaller than this are already small enough — skip compression. */
const SKIP_BELOW_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Diagnostics describing what compression did. `skipped` is true whenever the
 * original file is returned unchanged (already small, no size gain, or a
 * decode/canvas failure). `width`/`height` are the output dimensions when the
 * image was actually re-encoded, otherwise null.
 */
export interface CompressionStats {
  skipped: boolean;
  originalBytes: number;
  compressedBytes: number;
  /** compressedBytes / originalBytes — 1 when skipped. */
  compressionRatio: number;
  width: number | null;
  height: number | null;
}

function passthrough(file: File): { file: File; stats: CompressionStats } {
  return {
    file,
    stats: {
      skipped: true,
      originalBytes: file.size,
      compressedBytes: file.size,
      compressionRatio: 1,
      width: null,
      height: null,
    },
  };
}

/**
 * Compress a room image and return the (possibly unchanged) file together with
 * stats for diagnostics. Never rejects — on any failure it resolves with the
 * original file so the upload can still proceed.
 */
export async function compressRoomImageWithStats(
  file: File,
): Promise<{ file: File; stats: CompressionStats }> {
  if (file.size <= SKIP_BELOW_BYTES) return passthrough(file);

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(passthrough(file)); // corrupt / unsupported format — send original
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
        resolve(passthrough(file)); // canvas unavailable
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(passthrough(file)); // no gain — send original
            return;
          }

          // Keep the same base name but force .jpg extension so the server
          // receives a consistent MIME type.
          const compressedName = file.name.replace(/\.[^.]+$/, ".jpg");
          const compressedFile = new File([blob], compressedName, { type: "image/jpeg" });
          resolve({
            file: compressedFile,
            stats: {
              skipped: false,
              originalBytes: file.size,
              compressedBytes: compressedFile.size,
              compressionRatio: compressedFile.size / file.size,
              width: w,
              height: h,
            },
          });
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };

    img.src = objectUrl;
  });
}

/**
 * Backward-compatible wrapper that returns just the file. Existing callers that
 * don't need stats keep working unchanged.
 */
export async function compressRoomImage(file: File): Promise<File> {
  const { file: result } = await compressRoomImageWithStats(file);
  return result;
}
