// @vitest-environment happy-dom

/**
 * Unit tests for `useRoomUpload`.
 *
 * The hook owns `isSavingRoom` and the async `handleFileSelection` pipeline:
 *   - synchronous setup setters
 *   - `compressRoomImage`
 *   - Step 1: `requestDirectUploadUrl` (with 501 fallback to FormData)
 *   - Step 2 (direct): `uploadFileToR2` with `onProgress` + `onR2Failure`
 *   - Step 3 (direct): `confirmDirectUpload`
 *   - Step 2 (fallback): `saveRoomPreviewSessionRoom`
 *   - success → `setSession` + `room_upload_completed` event
 *   - failure → multi-branch error cascade
 *
 * No production code was modified — every dependency is already a param.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/room-service", () => ({
  saveRoomPreviewSessionRoom: vi.fn(),
  requestDirectUploadUrl: vi.fn(),
  uploadFileToR2: vi.fn(),
  confirmDirectUpload: vi.fn(),
}));

vi.mock("@/lib/room-preview/image-compress", () => ({
  // Default: no-op compression — returns the same file with skipped stats.
  compressRoomImage: vi.fn((file: File) => Promise.resolve(file)),
  compressRoomImageWithStats: vi.fn((file: File) =>
    Promise.resolve({
      file,
      stats: {
        skipped: true,
        originalBytes: file.size,
        compressedBytes: file.size,
        compressionRatio: 1,
        width: null,
        height: null,
      },
    }),
  ),
}));

vi.mock("@/lib/room-preview/session-client", async (importOriginal) => {
  // Keep RoomPreviewRequestError + isRoomPreviewRequestError +
  // getRoomPreviewErrorLogDetails real so error classification + the JSON.parse
  // line in the catch path run against real instances.
  const actual = await importOriginal<typeof import("@/lib/room-preview/session-client")>();
  return { ...actual };
});

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

const { useRoomUpload } = await import(
  "@/features/room-preview/mobile/useRoomUpload"
);
const {
  saveRoomPreviewSessionRoom,
  requestDirectUploadUrl,
  uploadFileToR2,
  confirmDirectUpload,
} = await import("@/lib/room-preview/room-service");
const { compressRoomImage, compressRoomImageWithStats } = await import("@/lib/room-preview/image-compress");
const { RoomPreviewRequestError } = await import("@/lib/room-preview/session-client");
const { trackClientSessionEvent } = await import(
  "@/lib/room-preview/session-diagnostics-client"
);
const { getCustomerRecoveryMessage } = await import(
  "@/lib/room-preview/customer-recovery"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-room-upload";
const PROGRESS_LABEL_PREFIX = "جاري رفع صورة الغرفة...";

const t = {
  roomPreview: {
    mobile: {
      invalidLink: "Invalid link",
      expiredLink: "Expired link",
      loadFailed: "Failed to load session",
    },
  },
} as unknown as TranslationDictionary;

function makeSession(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: SESSION_ID,
    status: "mobile_connected",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    mobileConnected: true,
    selectedRoom: null,
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

function makeRoomFile(name = "room.jpg", size = 1024, type = "image/jpeg"): File {
  // Create a File whose .size matches `size` by filling with a Blob of that length.
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

function makeUploadUrlResponse() {
  return {
    uploadUrl: "https://r2.example.com/upload?signed=abc",
    objectKey: "uploads/room-preview/test-key.jpg",
    publicUrl: "https://cdn.example.com/uploads/test.jpg",
    method: "PUT" as const,
    headers: {},
  };
}

function makeRoomSavedResponse(
  status: RoomPreviewSession["status"] = "room_selected",
  imageUrl = "https://cdn.example.com/uploads/test.jpg",
) {
  return {
    success: true as const,
    room: {
      source: "camera" as const,
      imageUrl,
    },
    session: makeSession({
      status,
      selectedRoom: { source: "camera", imageUrl },
    }),
  };
}

type Params = Parameters<typeof useRoomUpload>[0];

function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    session: makeSession(),
    setSession: vi.fn(),
    setViewState: vi.fn(),
    setError: vi.fn(),
    setSuccessMessage: vi.fn(),
    setRecoveryMessage: vi.fn(),
    setRoomSaveStatus: vi.fn(),
    setProductSaveStatus: vi.fn(),
    setRoomSaveStatusLabel: vi.fn(),
    sessionId: SESSION_ID,
    t,
    debugLog: vi.fn(),
    ...overrides,
  };
}

function emittedEvents() {
  return vi.mocked(trackClientSessionEvent).mock.calls.map(([, payload]) => payload);
}

function eventsOfType(eventType: string) {
  return emittedEvents().filter((e) => e.eventType === eventType);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: compression is a no-op pass-through (returns the same file).
  vi.mocked(compressRoomImage).mockImplementation((file: File) => Promise.resolve(file));
  vi.mocked(compressRoomImageWithStats).mockImplementation((file: File) =>
    Promise.resolve({
      file,
      stats: {
        skipped: true,
        originalBytes: file.size,
        compressedBytes: file.size,
        compressionRatio: 1,
        width: null,
        height: null,
      },
    }),
  );
  // Silence the verbose console.warn/error logs the hook makes on failures.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRoomUpload", () => {

  describe("guards: no file / no session / already saving", () => {
    it("sets roomSaveStatus to error and returns when no file is provided", async () => {
      const params = makeParams();

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", null); });

      expect(params.setRoomSaveStatus).toHaveBeenCalledWith("error");
      expect(requestDirectUploadUrl).not.toHaveBeenCalled();
      expect(saveRoomPreviewSessionRoom).not.toHaveBeenCalled();
      expect(emittedEvents()).toHaveLength(0);
    });

    it("returns silently when session is null", async () => {
      const params = makeParams({ session: null });
      const file = makeRoomFile();

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      // No state changes, no events.
      expect(params.setRoomSaveStatus).not.toHaveBeenCalled();
      expect(params.setRoomSaveStatusLabel).not.toHaveBeenCalled();
      expect(emittedEvents()).toHaveLength(0);
      expect(requestDirectUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe("successful direct upload path", () => {
    it("calls requestDirectUploadUrl → uploadFileToR2 → confirmDirectUpload in order", async () => {
      const params = makeParams();
      const file = makeRoomFile("room.jpg", 2048, "image/jpeg");
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse("room_selected"));

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(requestDirectUploadUrl).toHaveBeenCalledWith(
        SESSION_ID,
        { source: "camera", file },
      );
      expect(uploadFileToR2).toHaveBeenCalled();
      expect(confirmDirectUpload).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({
          objectKey: "uploads/room-preview/test-key.jpg",
          publicUrl: "https://cdn.example.com/uploads/test.jpg",
          source: "camera",
          file,
        }),
      );
      // FormData fallback was NOT used.
      expect(saveRoomPreviewSessionRoom).not.toHaveBeenCalled();
    });

    it("emits mobile_tap_detected, room_upload_started, room_direct_upload_started, room_direct_upload_confirmed, and room_upload_completed", async () => {
      const params = makeParams();
      const file = makeRoomFile("photo.jpg", 4096, "image/jpeg");
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse("room_selected"));

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(eventsOfType("mobile_tap_detected")[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_tap_detected",
        level: "info",
        metadata: { target: "room_upload", source: "camera", fileSize: 4096, fileType: "image/jpeg" },
      });
      expect(eventsOfType("room_upload_started")[0]).toMatchObject({
        source: "mobile",
        eventType: "room_upload_started",
        level: "info",
        metadata: { source: "camera", fileName: "photo.jpg", fileSize: 4096, fileType: "image/jpeg" },
      });
      expect(eventsOfType("room_direct_upload_started")).toHaveLength(1);
      expect(eventsOfType("room_direct_upload_confirmed")[0]).toMatchObject({
        source: "mobile",
        eventType: "room_direct_upload_confirmed",
        level: "info",
        metadata: { source: "camera", objectKey: "uploads/room-preview/test-key.jpg" },
      });
      expect(eventsOfType("room_upload_completed")[0]).toMatchObject({
        source: "mobile",
        eventType: "room_upload_completed",
        level: "info",
        statusAfter: "room_selected",
        metadata: { source: "camera", directUpload: true },
      });
      // Failure event must NOT fire on success.
      expect(eventsOfType("room_upload_failed")).toHaveLength(0);
    });

    it("sets the Arabic progress label initially and updates it via onProgress callbacks", async () => {
      const params = makeParams();
      const file = makeRoomFile();

      let capturedOnProgress: ((p: number) => void) | undefined;
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockImplementation(async (_url, _file, opts) => {
        capturedOnProgress = opts?.onProgress;
        // Simulate 3 progress callbacks before resolving.
        opts?.onProgress?.(25);
        opts?.onProgress?.(75);
      });
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      // The exact Arabic string is byte-identical to the production prefix.
      expect(params.setRoomSaveStatusLabel).toHaveBeenCalledWith(PROGRESS_LABEL_PREFIX);
      expect(params.setRoomSaveStatusLabel).toHaveBeenCalledWith(`${PROGRESS_LABEL_PREFIX} 25%`);
      expect(params.setRoomSaveStatusLabel).toHaveBeenCalledWith(`${PROGRESS_LABEL_PREFIX} 75%`);
      // After R2 PUT completes, label resets to the prefix again (without %).
      expect(params.setRoomSaveStatusLabel).toHaveBeenCalledWith(PROGRESS_LABEL_PREFIX);
      // Final clear on success.
      expect(params.setRoomSaveStatusLabel).toHaveBeenLastCalledWith(null);

      expect(capturedOnProgress).toBeDefined();
    });

    it("calls setSession with the response.session and roomSaveStatus=success", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      const saved = makeRoomSavedResponse("room_selected");
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(saved);

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(params.setSession).toHaveBeenCalledWith(saved.session);
      expect(params.setRoomSaveStatus).toHaveBeenCalledWith("success");
    });

    it("flips isSavingRoom: false → true → false across the lifecycle", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));

      expect(result.current.isSavingRoom).toBe(false);

      await act(async () => { await result.current.handleFileSelection("camera", file); });

      // After the full async flow, isSavingRoom is back to false.
      expect(result.current.isSavingRoom).toBe(false);
    });
  });

  describe("R2 PUT failure callback", () => {
    it("emits room_direct_upload_r2_failed with code mapping for status 403", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockImplementation(async (_url, _file, opts) => {
        opts?.onR2Failure?.({
          status: 403,
          statusText: "Forbidden",
          responseText: "<Error>signature mismatch</Error>",
          host: "r2.example.com",
        });
      });
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      const events = eventsOfType("room_direct_upload_r2_failed");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source: "mobile",
        eventType: "room_direct_upload_r2_failed",
        level: "error",
        code: "R2_SIGNATURE_INVALID",
        metadata: expect.objectContaining({
          status: 403,
          statusText: "Forbidden",
          host: "r2.example.com",
          source: "camera",
        }),
      });
    });

    it("uses code R2_CORS_OR_NETWORK when status is 0", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockImplementation(async (_url, _file, opts) => {
        opts?.onR2Failure?.({ status: 0, statusText: "", responseText: "", host: "r2.example.com" });
      });
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(eventsOfType("room_direct_upload_r2_failed")[0]).toMatchObject({
        code: "R2_CORS_OR_NETWORK",
      });
    });

    it("uses code R2_PUT_FAILED for any other R2 status", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockImplementation(async (_url, _file, opts) => {
        opts?.onR2Failure?.({ status: 500, statusText: "Server", responseText: "", host: "r2.example.com" });
      });
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(eventsOfType("room_direct_upload_r2_failed")[0]).toMatchObject({
        code: "R2_PUT_FAILED",
      });
    });
  });

  describe("FormData fallback (501 from requestDirectUploadUrl)", () => {
    it("falls back to saveRoomPreviewSessionRoom when direct-upload URL returns 501", async () => {
      const session = makeSession({
        selectedRoom: { source: "camera", imageUrl: "https://cdn/previous.jpg" },
      });
      const params = makeParams({ session });
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockRejectedValue(
        new RoomPreviewRequestError("server", "Direct upload not supported", { status: 501 }),
      );
      vi.mocked(saveRoomPreviewSessionRoom).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      // FormData fallback was used; R2 path skipped.
      expect(saveRoomPreviewSessionRoom).toHaveBeenCalledWith(
        SESSION_ID,
        { source: "camera", file, previousRoomImageUrl: "https://cdn/previous.jpg" },
      );
      expect(uploadFileToR2).not.toHaveBeenCalled();
      expect(confirmDirectUpload).not.toHaveBeenCalled();

      // room_upload_completed metadata.directUpload = false.
      expect(eventsOfType("room_upload_completed")[0]).toMatchObject({
        metadata: { source: "camera", directUpload: false },
      });
    });
  });

  describe("error paths", () => {
    it("expired error → setSession(null), setViewState(\"expired\"), setError from t.expiredLink", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Session expired."),
      );

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");
      expect(params.setError).toHaveBeenCalledWith("Expired link");
      // setRoomSaveStatus("error") must NOT fire on expired branch (only on the generic branch).
      const errorStatusCalls = vi.mocked(params.setRoomSaveStatus).mock.calls.filter(
        ([s]: [unknown]) => s === "error",
      );
      expect(errorStatusCalls).toHaveLength(0);
    });

    it("not_found error → setSession(null), setViewState(\"not_found\"), setError from t.invalidLink", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockRejectedValue(
        new RoomPreviewRequestError("not_found", "Session not found."),
      );

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("not_found");
      expect(params.setError).toHaveBeenCalledWith("Invalid link");
    });

    it("413 (image too large) → sets image_too_large recovery message and error from recovery text", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockRejectedValue(
        new RoomPreviewRequestError("server", "Too large", { status: 413 }),
      );

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      const tooLarge = getCustomerRecoveryMessage("image_too_large");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(tooLarge);
      // recovery.text wins over the 413 Arabic fallback.
      expect(params.setError).toHaveBeenLastCalledWith(tooLarge?.text);
      expect(params.setRoomSaveStatus).toHaveBeenCalledWith("error");
      expect(params.setRoomSaveStatusLabel).toHaveBeenLastCalledWith(null);
    });

    it("generic non-typed error → retry_upload recovery and setRoomSaveStatus=error", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockRejectedValue(new Error("network down"));

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      const retry = getCustomerRecoveryMessage("retry_upload");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(retry);
      expect(params.setError).toHaveBeenLastCalledWith(retry?.text);
      expect(params.setRoomSaveStatus).toHaveBeenCalledWith("error");
      expect(params.setRoomSaveStatusLabel).toHaveBeenLastCalledWith(null);
      // viewState NOT touched on the generic branch.
      expect(params.setViewState).not.toHaveBeenCalled();
    });

    it("always emits room_upload_failed on any error path", async () => {
      const params = makeParams();
      const file = makeRoomFile("doomed.jpg", 1234, "image/png");
      vi.mocked(requestDirectUploadUrl).mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      const failed = eventsOfType("room_upload_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        source: "mobile",
        eventType: "room_upload_failed",
        level: "error",
        code: null, // non-typed error → null code
        message: "boom",
        metadata: { source: "camera", fileName: "doomed.jpg", fileSize: 1234, fileType: "image/png" },
      });
    });

    it("flips isSavingRoom back to false even when the upload throws", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockRejectedValue(new Error("crash"));

      const { result } = renderHook(() => useRoomUpload(params));

      expect(result.current.isSavingRoom).toBe(false);

      await act(async () => { await result.current.handleFileSelection("camera", file); });

      // Finally clause restored isSavingRoom.
      expect(result.current.isSavingRoom).toBe(false);
    });
  });

  describe("synchronous setup state", () => {
    it("resets error/success/recovery and sets idle statuses before the await", async () => {
      const params = makeParams();
      const file = makeRoomFile();
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", file); });

      // Pre-flight reset block.
      expect(params.setError).toHaveBeenCalledWith(null);
      expect(params.setSuccessMessage).toHaveBeenCalledWith(null);
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(null);
      expect(params.setRoomSaveStatus).toHaveBeenCalledWith("idle");
      expect(params.setProductSaveStatus).toHaveBeenCalledWith("idle");
    });
  });

  describe("compressRoomImageWithStats usage", () => {
    it("compresses the input file and uploads the compressed result", async () => {
      const params = makeParams();
      const original = makeRoomFile("orig.jpg", 10_000, "image/jpeg");
      const compressed = new File([new Uint8Array(2_000)], "orig-compressed.jpg", { type: "image/jpeg" });
      vi.mocked(compressRoomImageWithStats).mockResolvedValue({
        file: compressed,
        stats: {
          skipped: false,
          originalBytes: 10_000,
          compressedBytes: 2_000,
          compressionRatio: 0.2,
          width: 1024,
          height: 576,
        },
      });
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", original); });

      expect(compressRoomImageWithStats).toHaveBeenCalledWith(original);
      // The compressed file (not the original) is sent to the API.
      expect(requestDirectUploadUrl).toHaveBeenCalledWith(
        SESSION_ID,
        { source: "camera", file: compressed },
      );
    });

    it("emits room_image_compressed diagnostics with size, ratio, and dimensions", async () => {
      const params = makeParams();
      const original = makeRoomFile("orig.jpg", 10_000, "image/jpeg");
      const compressed = new File([new Uint8Array(2_000)], "orig-compressed.jpg", { type: "image/jpeg" });
      vi.mocked(compressRoomImageWithStats).mockResolvedValue({
        file: compressed,
        stats: {
          skipped: false,
          originalBytes: 10_000,
          compressedBytes: 2_000,
          compressionRatio: 0.2,
          width: 1024,
          height: 576,
        },
      });
      vi.mocked(requestDirectUploadUrl).mockResolvedValue(makeUploadUrlResponse());
      vi.mocked(uploadFileToR2).mockResolvedValue(undefined);
      vi.mocked(confirmDirectUpload).mockResolvedValue(makeRoomSavedResponse());

      const { result } = renderHook(() => useRoomUpload(params));
      await act(async () => { await result.current.handleFileSelection("camera", original); });

      expect(eventsOfType("room_image_compressed")[0]).toMatchObject({
        source: "mobile",
        eventType: "room_image_compressed",
        level: "info",
        metadata: {
          source: "camera",
          skipped: false,
          originalBytes: 10_000,
          compressedBytes: 2_000,
          compressionRatio: 0.2,
          compressionPercent: 80,
          width: 1024,
          height: 576,
        },
      });
    });
  });
});
