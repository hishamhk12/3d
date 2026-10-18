// @vitest-environment happy-dom
import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const roomService = vi.hoisted(() => ({
  requestDirectUploadUrl: vi.fn(),
  saveRoomPreviewSessionRoom: vi.fn(),
  uploadFileToR2: vi.fn(),
  confirmDirectUpload: vi.fn(),
}));

vi.mock("@/lib/room-preview/room-service", () => roomService);
vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

import { useRoomUpload } from "@/features/room-preview/mobile/useRoomUpload";
import { RoomPreviewRequestError } from "@/lib/room-preview/session-client";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

describe("useRoomUpload", () => {
  // Regression guard for the dev upload path. (The Strict Mode mount → cleanup →
  // mount cycle that caused the silent abort doesn't double-invoke effects in
  // this test environment, so this covers the 501 → FormData fallback flow.)
  it("uploads through the FormData fallback when direct upload returns 501", async () => {
    // Local/dev storage: no signed URL → FormData fallback.
    roomService.requestDirectUploadUrl.mockRejectedValue(
      new RoomPreviewRequestError("server", "Direct upload is only available in production.", { status: 501 }),
    );
    const uploadedSession = { id: "s1", status: "room_selected", selectedRoom: null } as unknown as RoomPreviewSession;
    roomService.saveRoomPreviewSessionRoom.mockResolvedValue({ room: {}, session: uploadedSession });

    const setters = {
      setSession: vi.fn(),
      setViewState: vi.fn(),
      setError: vi.fn(),
      setSuccessMessage: vi.fn(),
      setRecoveryMessage: vi.fn(),
      setRoomSaveStatus: vi.fn(),
      setProductSaveStatus: vi.fn(),
      setRoomSaveStatusLabel: vi.fn(),
    };

    const { result } = renderHook(
      () =>
        useRoomUpload({
          session: { id: "s1", status: "mobile_connected", selectedRoom: null } as unknown as RoomPreviewSession,
          sessionId: "s1",
          t: {} as never,
          debugLog: () => {},
          ...setters,
        }),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    );

    // Small photo (< 1 MB) — compression is skipped, so nothing async precedes the upload.
    const file = new File([new Uint8Array(400 * 1024)], "IMG_3042.jpeg", { type: "image/jpeg" });
    await act(async () => {
      await result.current.handleFileSelection("gallery", file);
    });

    expect(roomService.saveRoomPreviewSessionRoom).toHaveBeenCalledTimes(1);
    expect(setters.setRoomSaveStatus).toHaveBeenCalledWith("success");
    expect(result.current.isSavingRoom).toBe(false);
  });
});
