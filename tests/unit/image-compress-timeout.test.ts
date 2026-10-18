import { afterEach, describe, expect, it, vi } from "vitest";
import { compressRoomImageWithStats } from "@/lib/room-preview/image-compress";

/** Image stub whose onload/onerror never fire — mimics the iOS hang. */
class HangingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
}

function bigFile() {
  return new File([new Uint8Array(2 * 1024 * 1024)], "IMG_3114.jpeg", { type: "image/jpeg" });
}

describe("compressRoomImageWithStats", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("falls back to the original file when the browser never decodes the image", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", HangingImage);
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:room", revokeObjectURL: revoke });

    const file = bigFile();
    const pending = compressRoomImageWithStats(file);
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await pending;
    expect(result.file).toBe(file);
    expect(result.stats.skipped).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:room");
  });

  it("falls back to the original file when drawing to the canvas throws", async () => {
    class LoadingImage extends HangingImage {
      naturalWidth = 4000;
      naturalHeight = 3000;
    }
    const created: LoadingImage[] = [];
    vi.stubGlobal(
      "Image",
      class extends LoadingImage {
        constructor() {
          super();
          created.push(this);
        }
      },
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:room", revokeObjectURL: () => {} });
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {
            throw new Error("canvas too large");
          },
        }),
      }),
    });

    const file = bigFile();
    const pending = compressRoomImageWithStats(file);
    created[0]?.onload?.();

    const result = await pending;
    expect(result.file).toBe(file);
    expect(result.stats.skipped).toBe(true);
  });
});
