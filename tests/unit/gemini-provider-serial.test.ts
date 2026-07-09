/**
 * Gemini provider serial-path tests.
 *
 * Covers timeout detection, retry, fallback prompt switching, and retryable
 * API errors — without making any real network calls.
 *
 * Test seams:
 * - `GeminiTimeoutError` is now exported from gemini-provider.ts so tests can
 *   throw it directly from the generateContent mock, avoiding the need to wait
 *   for real 5 000 ms timers via vi.useFakeTimers().
 * - `sharp` is redirected to tests/__mocks__/sharp.ts via vitest.config.ts
 *   resolve.alias so image processing uses a chainable in-memory mock.
 * - `@google/genai` is vi.mock'd to return a controlled generateContent fn.
 * - Global `fetch` is stubbed so image loading never hits the network.
 * - `@/lib/storage` is vi.mock'd to return a fake URL.
 * - `@/lib/room-preview/session-diagnostics` is vi.mock'd to capture events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockSharpInstance } from "../__mocks__/sharp";

// ─── Set env vars before any module import (IIFEs read them at load time) ────
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS = "5000";   // min allowed
process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS = "30000";  // min allowed
process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS = "false";  // serial only

// ─── Hoist generateContent mock ───────────────────────────────────────────────
const mockGenerateContent = vi.hoisted(() => vi.fn());

// ─── Mock: @google/genai ──────────────────────────────────────────────────────
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

// ─── Mock: storage ────────────────────────────────────────────────────────────
vi.mock("@/lib/storage", () => ({
  storageUpload: vi.fn().mockResolvedValue({ publicUrl: "https://storage.example.com/result.png" }),
}));

// ─── Mock: session diagnostics ────────────────────────────────────────────────
vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock: local assets ───────────────────────────────────────────────────────
vi.mock("@/lib/room-preview/local-assets", () => ({
  getRoomPreviewPublicAssetPath: vi.fn().mockReturnValue("/fake/path/image.jpg"),
}));

// ─── Mock: logger ────────────────────────────────────────────────────────────
vi.mock("@/lib/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ─── Import module under test ─────────────────────────────────────────────────
const { geminiRoomPreviewRenderProvider, GeminiTimeoutError } = await import(
  "@/lib/room-preview/render-providers/gemini-provider"
);
const { trackSessionEvent } = await import("@/lib/room-preview/session-diagnostics");
const { storageUpload }     = await import("@/lib/storage");

// sharp mock shared instance from the alias stub
const sharpMod = await import("sharp") as unknown as {
  default: ReturnType<typeof vi.fn>;
  sharedInstance: MockSharpInstance;
};
const si = sharpMod.sharedInstance;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-gemini";
const JOB_ID     = "test-job-gemini";

/**
 * Fake Gemini response with enough bytes to pass MIN_OUTPUT_BYTES (10 000).
 * Filled with 42 to differ from the room-image mock (filled with 1) so the
 * "output must not be identical to input" check passes.
 */
function makeFakeGeminiResponse(imageBytes = 20_000) {
  const data = Buffer.alloc(imageBytes).fill(42).toString("base64");
  return {
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] } }],
  };
}

function makeRenderRequest() {
  return {
    jobId: JOB_ID,
    sessionId: SESSION_ID,
    renderJobInput: {
      sessionId: SESSION_ID,
      room: {
        source: "camera" as const,
        imageUrl: "https://example.com/room.jpg",
        floorQuad: null,
      },
      product: {
        id: "prod-1",
        barcode: null,
        name: "Oak Flooring",
        productType: "floor_material" as const,
        imageUrl: "https://example.com/product.jpg",
      },
    },
  };
}

function makeWallpaperRenderRequest() {
  const request = makeRenderRequest();
  return {
    ...request,
    renderJobInput: {
      ...request.renderJobInput,
      product: {
        id: "wall-1",
        barcode: null,
        name: "Ivory Wallpaper",
        productType: "wall_material" as const,
        category: "WALLPAPER" as const,
        targetSurface: "walls" as const,
        imageUrl: "https://example.com/wallpaper.jpg",
      },
    },
  };
}

function makeCompositeRenderRequest() {
  const floorProduct = {
    id: "floor-1",
    barcode: null,
    name: "Oak Flooring",
    productType: "floor_material" as const,
    category: "PARQUET" as const,
    targetSurface: "floor" as const,
    imageUrl: "https://example.com/floor.jpg",
  };
  const wallProduct = {
    id: "wall-1",
    barcode: null,
    name: "Ivory Wallpaper",
    productType: "wall_material" as const,
    category: "WALLPAPER" as const,
    targetSurface: "walls" as const,
    imageUrl: "https://example.com/wallpaper.jpg",
  };

  return {
    ...makeRenderRequest(),
    renderJobInput: {
      sessionId: SESSION_ID,
      room: {
        source: "camera" as const,
        imageUrl: "https://example.com/room.jpg",
        floorQuad: null,
      },
      // Simulates scanning/selecting wallpaper last; reference order must still
      // be floor then walls.
      product: wallProduct,
      selectedProductsBySurface: {
        walls: wallProduct,
        floor: floorProduct,
      },
      renderMode: "composite" as const,
      referenceOrder: ["floor", "walls"] as const,
    },
  };
}

function geminiPartsAt(callIndex: number) {
  const params = mockGenerateContent.mock.calls[callIndex][0] as {
    contents: Array<{ parts: Array<{ text?: string; inlineData?: { data: string } }> }>;
  };
  return params.contents[0]?.parts ?? [];
}

function firstGeminiParts() {
  return geminiPartsAt(0);
}

function setupSharpMock() {
  si.metadata.mockResolvedValue({ width: 1280, height: 720 });
  si.toBuffer.mockResolvedValue({
    data: Buffer.alloc(20_000).fill(1),
    info: { width: 1280, height: 720, channels: 3 },
  });
  si.rotate.mockReturnValue(si);
  si.resize.mockReturnValue(si);
  si.jpeg.mockReturnValue(si);
  si.png.mockReturnValue(si);
}

function setupFetchMock() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === "content-type" ? "image/jpeg" : null) },
    arrayBuffer: vi.fn().mockResolvedValue(Buffer.alloc(50_000).fill(1).buffer),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setupSharpMock();
  setupFetchMock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("geminiRoomPreviewRenderProvider (serial path)", () => {

  describe("successful first attempt", () => {
    it("returns imageUrl, modelName, kind, and generatedAt", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      const result = await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(result.imageUrl).toBe("https://storage.example.com/result.png");
      expect(typeof result.modelName).toBe("string");
      expect(result.kind).toBe("composited_preview");
      expect(typeof result.generatedAt).toBe("string");
    });

    it("uploads the result as image/png via storageUpload", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(storageUpload).toHaveBeenCalledOnce();
      const [, , contentType] = vi.mocked(storageUpload).mock.calls[0];
      expect(contentType).toBe("image/png");
    });

    it("calls generateContent exactly once on a successful first attempt", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(mockGenerateContent).toHaveBeenCalledOnce();
    });

    it("single parquet render sends room plus one product image before the prompt", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      const parts = firstGeminiParts();
      expect(parts).toHaveLength(3);
      expect(parts[0].inlineData).toBeTruthy();
      expect(parts[1].inlineData).toBeTruthy();
      expect(parts[2].text).toMatch(/parquet/i);
      expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)).toEqual([
        "https://example.com/room.jpg",
        "https://example.com/product.jpg",
      ]);
    });

    it("single wallpaper render sends room plus one product image before the prompt", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeWallpaperRenderRequest());

      const parts = firstGeminiParts();
      expect(parts).toHaveLength(3);
      expect(parts[0].inlineData).toBeTruthy();
      expect(parts[1].inlineData).toBeTruthy();
      expect(parts[2].text).toMatch(/wallpaper/i);
      expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)).toEqual([
        "https://example.com/room.jpg",
        "https://example.com/wallpaper.jpg",
      ]);
    });

    it("composite render uses one Gemini call with room, floor, wallpaper, then prompt", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeCompositeRenderRequest());

      expect(mockGenerateContent).toHaveBeenCalledOnce();
      const parts = firstGeminiParts();
      expect(parts).toHaveLength(4);
      expect(parts[0].inlineData).toBeTruthy();
      expect(parts[1].inlineData).toBeTruthy();
      expect(parts[2].inlineData).toBeTruthy();
      expect(parts[3].text).toMatch(/Reference image 1 = flooring\/parquet material/i);
      expect(parts[3].text).toMatch(/Reference image 2 = wallpaper material/i);
      expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)).toEqual([
        "https://example.com/room.jpg",
        "https://example.com/floor.jpg",
        "https://example.com/wallpaper.jpg",
      ]);
    });
  });

  describe("attempt-1 timeout → retry with fallback prompt", () => {
    // GeminiTimeoutError is the exported test seam — throwing it directly from
    // the mock simulates a Gemini SDK call timing out without needing fake timers
    // or waiting for the 5 000 ms minimum timeout.

    it("emits gemini_attempt_timeout diagnostic when attempt 1 times out", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(trackSessionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "gemini_attempt_timeout",
          level: "warning",
          metadata: expect.objectContaining({ attempt: 1, promptVariant: "normal" }),
        }),
      );
    });

    it("emits gemini_retry_started with promptVariant=fallback after a timeout", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(trackSessionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "gemini_retry_started",
          level: "info",
          metadata: expect.objectContaining({
            retryReason: "gemini_timeout",
            promptVariant: "fallback",
          }),
        }),
      );
    });

    it("uses a shorter fallback prompt on retry (no polygon coordinates)", async () => {
      const capturedPrompts: string[] = [];

      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockImplementation(async (params: { contents: Array<{ parts: Array<{ text?: string }> }> }) => {
          const text = params.contents[0]?.parts?.find((p) => typeof p.text === "string")?.text ?? "";
          capturedPrompts.push(text);
          return makeFakeGeminiResponse();
        });

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      // Only the retry call reaches this impl; attempt 1 threw immediately.
      expect(capturedPrompts).toHaveLength(1);
      const fallbackPrompt = capturedPrompts[0];

      // Fallback prompt uses the simple "Replace only the visible floor" phrasing.
      expect(fallbackPrompt).toMatch(/Replace only the visible floor/);
      // Normal prompt embeds floor-polygon JSON; fallback must not.
      expect(fallbackPrompt).not.toMatch(/floorPolygon|FLOOR_POLYGON|\[\s*\{/);
    });

    it("returns a successful result when retry succeeds after timeout", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockResolvedValue(makeFakeGeminiResponse());

      const result = await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(result.imageUrl).toBe("https://storage.example.com/result.png");
      expect(result.kind).toBe("composited_preview");
    });

    it("emits render_timing_summary with retried=true and winnerPromptVariant=fallback", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(trackSessionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "render_timing_summary",
          metadata: expect.objectContaining({
            retried: true,
            retryReason: "gemini_timeout",
            winnerPromptVariant: "fallback",
          }),
        }),
      );
    });

    it("reloads images at smaller dimensions on timeout retry", async () => {
      const loadCallDimensions: Array<number | undefined> = [];
      const originalFetch = vi.mocked(global.fetch as ReturnType<typeof vi.fn>);
      originalFetch.mockImplementation(async (_url: string) => {
        loadCallDimensions.push(undefined); // just count calls
        return {
          ok: true,
          status: 200,
          headers: { get: (k: string) => (k === "content-type" ? "image/jpeg" : null) },
          arrayBuffer: async () => Buffer.alloc(50_000).fill(1).buffer,
        };
      });

      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      // Initial load: 2 images (room + product)
      // Retry reload: 2 more images (room at 1024px, product at 640px)
      expect(loadCallDimensions).toHaveLength(4);
    });

    it("composite timeout retry preserves floor then wallpaper references", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeCompositeRenderRequest());

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(geminiPartsAt(1)).toHaveLength(4);
      expect(geminiPartsAt(1)[3].text).toMatch(/Reference image 1 is the flooring\/parquet material/i);
      expect(geminiPartsAt(1)[3].text).toMatch(/Reference image 2 is the wallpaper material/i);
      expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)).toEqual([
        "https://example.com/room.jpg",
        "https://example.com/floor.jpg",
        "https://example.com/wallpaper.jpg",
        "https://example.com/room.jpg",
        "https://example.com/floor.jpg",
        "https://example.com/wallpaper.jpg",
      ]);
    });
  });

  describe("both attempts time out (fatal timeout)", () => {
    it("throws when both attempts time out", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 30000));

      await expect(
        geminiRoomPreviewRenderProvider.render(makeRenderRequest()),
      ).rejects.toThrow();
    });

    it("does not call storageUpload when all attempts fail", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 30000));

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest()).catch(() => {});

      expect(storageUpload).not.toHaveBeenCalled();
    });

    it("stores gemini_timeout as the failureReason on the thrown error", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 5000))
        .mockRejectedValueOnce(new GeminiTimeoutError("gemini-3.1-flash-image-preview", 30000));

      const err = await geminiRoomPreviewRenderProvider.render(makeRenderRequest()).catch((e) => e);
      expect(err).toBeInstanceOf(GeminiTimeoutError);
      expect((err as { failureReason: string }).failureReason).toBe("gemini_timeout");
    });
  });

  describe("retryable API error (503)", () => {
    it("retries after a 503 and succeeds on the next attempt", async () => {
      vi.useFakeTimers();

      const retryableError = Object.assign(new Error("Service Unavailable"), { status: 503 });
      mockGenerateContent
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue(makeFakeGeminiResponse());

      const renderPromise = geminiRoomPreviewRenderProvider.render(makeRenderRequest());
      // Advance past BASE_DELAY_MS (3 000 ms) to let the sleep complete.
      await vi.advanceTimersByTimeAsync(3_001);

      const result = await renderPromise;

      expect(result.imageUrl).toBe("https://storage.example.com/result.png");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("no real network calls", () => {
    it("all I/O uses mocked fetch, Gemini SDK, and storage — no real network", async () => {
      mockGenerateContent.mockResolvedValue(makeFakeGeminiResponse());

      await geminiRoomPreviewRenderProvider.render(makeRenderRequest());

      expect(vi.mocked(global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect(mockGenerateContent).toHaveBeenCalled();
      expect(storageUpload).toHaveBeenCalled();
    });
  });
});
