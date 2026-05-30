// @vitest-environment happy-dom

/**
 * Unit tests for `useProductSelection`.
 *
 * The hook owns `localProductId`, `productAbortRef`, the unmount-abort
 * effect, and the two product handlers:
 *
 *   - `handleProductSelect(productId)` — fires from the product list, uses
 *     an AbortController so a newer selection cancels older saves.
 *   - `handleProductCodeSelect(productCode)` — fires from the printed QR
 *     scan flow, intentionally NOT cancellable.
 *
 * No production code was modified — every dependency is already a param.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/product-service", () => ({
  saveRoomPreviewSessionProduct: vi.fn(),
}));

vi.mock("@/lib/room-preview/session-client", async (importOriginal) => {
  // Keep the real RoomPreviewRequestError + isRoomPreviewRequestError so the
  // hook's error classification runs against real instances.
  const actual = await importOriginal<typeof import("@/lib/room-preview/session-client")>();
  return { ...actual };
});

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

const { useProductSelection } = await import(
  "@/features/room-preview/mobile/useProductSelection"
);
const { saveRoomPreviewSessionProduct } = await import(
  "@/lib/room-preview/product-service"
);
const { RoomPreviewRequestError } = await import(
  "@/lib/room-preview/session-client"
);
const { trackClientSessionEvent } = await import(
  "@/lib/room-preview/session-diagnostics-client"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-product-selection";

const t = {
  roomPreview: {
    mobile: {
      invalidLink: "Invalid link",
      expiredLink: "Expired link",
      loadFailed: "Failed to load session",
      product: {
        saveFailed: "Could not save product",
      },
    },
  },
} as unknown as TranslationDictionary;

function makeSession(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: SESSION_ID,
    status: "room_selected",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    mobileConnected: true,
    selectedRoom: { source: "camera", imageUrl: "https://cdn/room.jpg" },
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

function makeProductSavedResponse(productId: string, status: RoomPreviewSession["status"] = "product_selected") {
  const product = {
    id: productId,
    barcode: null,
    name: `Product ${productId}`,
    productType: "floor_material" as const,
    imageUrl: `https://cdn/${productId}.jpg`,
  };
  return {
    product,
    session: makeSession({
      status,
      selectedProduct: product,
    }),
  };
}

type Params = Parameters<typeof useProductSelection>[0];

function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    session: makeSession(),
    setSession: vi.fn(),
    setViewState: vi.fn(),
    setError: vi.fn(),
    setSuccessMessage: vi.fn(),
    setRecoveryMessage: vi.fn(),
    setProductSaveStatus: vi.fn(),
    setIsSavingProduct: vi.fn(),
    productSavePromiseRef: { current: null } as MutableRefObject<Promise<RoomPreviewSession | null> | null>,
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

/** Drain pending microtasks so chained .then/.catch/.finally callbacks run. */
async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

/** A controllable promise. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useProductSelection", () => {

  describe("handleProductSelect — successful save", () => {
    it("calls saveRoomPreviewSessionProduct with productId and an AbortSignal", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(makeProductSavedResponse("p-1"));

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => {
        result.current.handleProductSelect("p-1");
        await flushMicrotasks();
      });

      expect(saveRoomPreviewSessionProduct).toHaveBeenCalledWith(
        SESSION_ID,
        { productId: "p-1" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("emits mobile_tap_detected and product_selected with correct metadata", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(makeProductSavedResponse("p-1", "product_selected"));

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        result.current.handleProductSelect("p-1");
        await flushMicrotasks();
      });

      expect(eventsOfType("mobile_tap_detected")[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_tap_detected",
        level: "info",
        metadata: { target: "product", productId: "p-1" },
      });
      expect(eventsOfType("product_selected")[0]).toMatchObject({
        source: "mobile",
        eventType: "product_selected",
        level: "info",
        statusAfter: "product_selected",
        metadata: { productId: "p-1" },
      });
    });

    it("sets the session and productSaveStatus=success on resolution", async () => {
      const params = makeParams();
      const saved = makeProductSavedResponse("p-1");
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(saved);

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        result.current.handleProductSelect("p-1");
        await flushMicrotasks();
      });

      expect(params.setSession).toHaveBeenCalledWith(saved.session);
      expect(params.setProductSaveStatus).toHaveBeenCalledWith("success");
      // No error / no viewState change on success.
      expect(params.setViewState).not.toHaveBeenCalled();
    });
  });

  describe("handleProductSelect — optimistic localProductId", () => {
    it("exposes the selected productId in result.localProductId after the synchronous setter fires", async () => {
      const params = makeParams();
      const { promise } = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct).mockReturnValue(promise);

      const { result } = renderHook(() => useProductSelection(params));

      // Before any call — initial null.
      expect(result.current.localProductId).toBeNull();

      await act(async () => {
        result.current.handleProductSelect("p-optimistic");
        // Don't drain promise — leave it pending; setLocalProductId already fired.
      });

      // Optimistic update reflected in the hook's return.
      expect(result.current.localProductId).toBe("p-optimistic");
    });

    it("resets error and successMessage synchronously and starts the saving state", async () => {
      const params = makeParams();
      const { promise } = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct).mockReturnValue(promise);

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        result.current.handleProductSelect("p-1");
      });

      expect(params.setError).toHaveBeenCalledWith(null);
      expect(params.setSuccessMessage).toHaveBeenCalledWith(null);
      expect(params.setIsSavingProduct).toHaveBeenCalledWith(true);
      expect(params.setProductSaveStatus).toHaveBeenCalledWith("idle");
    });
  });

  describe("handleProductSelect — abort prior in-flight save", () => {
    it("aborts the prior controller's signal when a newer selection arrives", async () => {
      const params = makeParams();
      const first = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct)
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(makeProductSavedResponse("p-2"));

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => {
        result.current.handleProductSelect("p-1");
      });

      // Capture the signal from the first call.
      const firstSignal = vi.mocked(saveRoomPreviewSessionProduct).mock.calls[0][2]?.signal as AbortSignal;
      expect(firstSignal.aborted).toBe(false);

      // Fire the newer selection.
      await act(async () => {
        result.current.handleProductSelect("p-2");
        await flushMicrotasks();
      });

      expect(firstSignal.aborted).toBe(true);

      // The two calls used distinct signals.
      const secondSignal = vi.mocked(saveRoomPreviewSessionProduct).mock.calls[1][2]?.signal as AbortSignal;
      expect(secondSignal).not.toBe(firstSignal);
      expect(secondSignal.aborted).toBe(false);

      // Resolve the dangling first promise so React doesn't complain on cleanup.
      await act(async () => {
        first.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });
    });
  });

  describe("handleProductSelect — aborted save is silent", () => {
    it("does NOT call setSession/setError when the first promise resolves after being aborted", async () => {
      const params = makeParams();
      const first = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct)
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(makeProductSavedResponse("p-2"));

      const { result } = renderHook(() => useProductSelection(params));

      // Start the first save (will be aborted).
      await act(async () => {
        result.current.handleProductSelect("p-1");
      });

      // Newer selection aborts the first.
      await act(async () => {
        result.current.handleProductSelect("p-2");
        await flushMicrotasks();
      });

      const setSessionCallsAfterSecond = vi.mocked(params.setSession).mock.calls.length;

      // Now resolve the FIRST (aborted) promise — its .then should short-circuit
      // because controller.signal.aborted is true.
      await act(async () => {
        first.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });

      // No new setSession or productSaveStatus call from the aborted resolution.
      expect(vi.mocked(params.setSession).mock.calls.length).toBe(setSessionCallsAfterSecond);
      // p-1's product_selected event must NOT fire.
      expect(eventsOfType("product_selected").filter(
        (e) => (e.metadata as { productId: string }).productId === "p-1",
      )).toHaveLength(0);
    });

    it("does NOT call setError when the catch path sees an aborted controller", async () => {
      const params = makeParams();
      const first = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct)
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(makeProductSavedResponse("p-2"));

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => { result.current.handleProductSelect("p-1"); });
      await act(async () => {
        result.current.handleProductSelect("p-2");
        await flushMicrotasks();
      });

      vi.mocked(params.setError).mockClear();

      // Reject the aborted first call.
      await act(async () => {
        first.reject(new Error("doesn't matter"));
        await flushMicrotasks();
      });

      // setError must NOT have been called from the aborted catch.
      expect(params.setError).not.toHaveBeenCalled();
    });
  });

  describe("handleProductSelect — generic failure", () => {
    it("sets error message via createActionErrorMessage and productSaveStatus=error", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockRejectedValue(new Error("network"));

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        result.current.handleProductSelect("p-3");
        await flushMicrotasks();
      });

      // Error.message takes precedence over the t.roomPreview.mobile.product.saveFailed fallback.
      expect(params.setError).toHaveBeenLastCalledWith("network");
      expect(params.setProductSaveStatus).toHaveBeenLastCalledWith("error");
      // viewState NOT changed.
      expect(params.setViewState).not.toHaveBeenCalled();
      expect(params.setSession).not.toHaveBeenCalled();
    });
  });

  describe("handleProductSelect — expired error", () => {
    it("clears session, sets viewState=expired, sets error from t.expiredLink", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Session has expired."),
      );

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        result.current.handleProductSelect("p-x");
        await flushMicrotasks();
      });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");
      expect(params.setError).toHaveBeenCalledWith("Expired link");
      // productSaveStatus must NOT switch to "error" on the expired branch.
      const errorStatusCalls = vi.mocked(params.setProductSaveStatus).mock.calls.filter(
        ([s]: [unknown]) => s === "error",
      );
      expect(errorStatusCalls).toHaveLength(0);
    });
  });

  describe("handleProductSelect — not_found error", () => {
    it("clears session, sets viewState=not_found, sets error from t.invalidLink", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockRejectedValue(
        new RoomPreviewRequestError("not_found", "Not found."),
      );

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        result.current.handleProductSelect("p-x");
        await flushMicrotasks();
      });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("not_found");
      expect(params.setError).toHaveBeenCalledWith("Invalid link");
    });
  });

  describe("handleProductCodeSelect — successful save from QR", () => {
    it("calls saveRoomPreviewSessionProduct with productCode and NO signal arg", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(makeProductSavedResponse("p-1"));

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => {
        await result.current.handleProductCodeSelect("CODE123");
      });

      // Only 2 args — QR-scan path is intentionally non-cancellable.
      expect(saveRoomPreviewSessionProduct).toHaveBeenCalledWith(SESSION_ID, { productCode: "CODE123" });
      expect(vi.mocked(saveRoomPreviewSessionProduct).mock.calls[0]).toHaveLength(2);
    });

    it("emits product_qr_confirmed and product_selected with source: \"printed_product_qr\"", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(makeProductSavedResponse("p-1", "product_selected"));

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        await result.current.handleProductCodeSelect("CODE123");
      });

      expect(eventsOfType("product_qr_confirmed")[0]).toMatchObject({
        source: "mobile",
        eventType: "product_qr_confirmed",
        level: "info",
        metadata: { productCode: "CODE123" },
      });
      expect(eventsOfType("product_selected")[0]).toMatchObject({
        source: "mobile",
        eventType: "product_selected",
        level: "info",
        statusAfter: "product_selected",
        metadata: {
          productCode: "CODE123",
          productId: "p-1",
          source: "printed_product_qr",
        },
      });
    });

    it("returns the persisted session on success", async () => {
      const params = makeParams();
      const saved = makeProductSavedResponse("p-1");
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(saved);

      const { result } = renderHook(() => useProductSelection(params));

      let returned: RoomPreviewSession | null = null;
      await act(async () => {
        returned = await result.current.handleProductCodeSelect("CODE123");
      });

      expect(returned).toBe(saved.session);
    });
  });

  describe("handleProductCodeSelect — resets UI state correctly", () => {
    it("clears error/success/recovery, sets localProductId, and toggles isSavingProduct", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockResolvedValue(makeProductSavedResponse("p-1"));

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => {
        await result.current.handleProductCodeSelect("CODE-XYZ");
      });

      expect(params.setError).toHaveBeenCalledWith(null);
      expect(params.setSuccessMessage).toHaveBeenCalledWith(null);
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(null);
      expect(params.setProductSaveStatus).toHaveBeenCalledWith("idle");
      // Optimistic localProductId.
      expect(result.current.localProductId).toBe("CODE-XYZ");
      // Saving state toggled true → false.
      expect(params.setIsSavingProduct).toHaveBeenCalledWith(true);
      expect(params.setIsSavingProduct).toHaveBeenLastCalledWith(false);
    });

    it("aborts and clears any in-flight productAbortRef before calling the API", async () => {
      const params = makeParams();
      const first = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct)
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(makeProductSavedResponse("p-qr"));

      const { result } = renderHook(() => useProductSelection(params));

      // Start a list-based save first.
      await act(async () => { result.current.handleProductSelect("p-list"); });
      const firstSignal = vi.mocked(saveRoomPreviewSessionProduct).mock.calls[0][2]?.signal as AbortSignal;

      // QR scan takes priority.
      await act(async () => {
        await result.current.handleProductCodeSelect("CODE-QR");
      });

      expect(firstSignal.aborted).toBe(true);

      // Resolve the dangling first promise.
      await act(async () => {
        first.resolve(makeProductSavedResponse("p-list"));
        await flushMicrotasks();
      });
    });
  });

  describe("handleProductCodeSelect — failure", () => {
    it("returns null and sets error/productSaveStatus on generic failure", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockRejectedValue(new Error("server"));

      const { result } = renderHook(() => useProductSelection(params));

      let returned: RoomPreviewSession | null | undefined;
      await act(async () => {
        returned = await result.current.handleProductCodeSelect("BAD");
      });

      expect(returned).toBeNull();
      expect(params.setError).toHaveBeenLastCalledWith("server");
      expect(params.setProductSaveStatus).toHaveBeenLastCalledWith("error");
      // viewState NOT touched.
      expect(params.setViewState).not.toHaveBeenCalled();
    });

    it("transitions viewState to expired on RoomPreviewRequestError(\"expired\")", async () => {
      const params = makeParams();
      vi.mocked(saveRoomPreviewSessionProduct).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Expired."),
      );

      const { result } = renderHook(() => useProductSelection(params));
      await act(async () => {
        await result.current.handleProductCodeSelect("BAD");
      });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");
      expect(params.setError).toHaveBeenCalledWith("Expired link");
    });
  });

  describe("productSavePromiseRef handoff", () => {
    it("assigns the in-flight promise to productSavePromiseRef and clears it on settle", async () => {
      const params = makeParams();
      const def = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct).mockReturnValue(def.promise);

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => { result.current.handleProductSelect("p-1"); });

      // While in-flight, the ref points to the save promise.
      expect(params.productSavePromiseRef.current).not.toBeNull();
      expect(params.productSavePromiseRef.current).toBeInstanceOf(Promise);

      // Resolve — finally should clear the ref.
      await act(async () => {
        def.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });

      expect(params.productSavePromiseRef.current).toBeNull();
    });

    it("does NOT clobber the ref when an aborted older save settles after a newer one", async () => {
      const params = makeParams();
      const first = deferred<ReturnType<typeof makeProductSavedResponse>>();
      const second = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => { result.current.handleProductSelect("p-1"); });
      const firstPromise = params.productSavePromiseRef.current;

      await act(async () => { result.current.handleProductSelect("p-2"); });
      // Ref now holds the SECOND promise.
      const secondPromise = params.productSavePromiseRef.current;
      expect(secondPromise).not.toBe(firstPromise);

      // Resolve the aborted first — its finally must NOT clear the ref (which
      // currently holds the second promise).
      await act(async () => {
        first.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });
      expect(params.productSavePromiseRef.current).toBe(secondPromise);

      // Resolve the second — its finally clears the ref.
      await act(async () => {
        second.resolve(makeProductSavedResponse("p-2"));
        await flushMicrotasks();
      });
      expect(params.productSavePromiseRef.current).toBeNull();
    });
  });

  describe("setIsSavingProduct behavior", () => {
    it("calls setIsSavingProduct(true) early and setIsSavingProduct(false) in finally", async () => {
      const params = makeParams();
      const def = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct).mockReturnValue(def.promise);

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => { result.current.handleProductSelect("p-1"); });

      // setIsSavingProduct(true) fired synchronously.
      expect(params.setIsSavingProduct).toHaveBeenCalledWith(true);
      // false has NOT yet been called.
      const trueCalls = vi.mocked(params.setIsSavingProduct).mock.calls.filter(([v]: [boolean]) => v === true).length;
      const falseCalls = vi.mocked(params.setIsSavingProduct).mock.calls.filter(([v]: [boolean]) => v === false).length;
      expect(trueCalls).toBe(1);
      expect(falseCalls).toBe(0);

      await act(async () => {
        def.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });

      // false fired in the finally.
      expect(params.setIsSavingProduct).toHaveBeenLastCalledWith(false);
    });

    it("does NOT call setIsSavingProduct(false) when an older request resolves while aborted", async () => {
      const params = makeParams();
      const first = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct)
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(makeProductSavedResponse("p-2"));

      const { result } = renderHook(() => useProductSelection(params));

      await act(async () => { result.current.handleProductSelect("p-1"); });
      await act(async () => {
        result.current.handleProductSelect("p-2");
        await flushMicrotasks();
      });

      // After p-2 resolves: one true (each call), one false (p-2's finally).
      const trueCount = vi.mocked(params.setIsSavingProduct).mock.calls.filter(([v]: [boolean]) => v === true).length;
      const falseCount = vi.mocked(params.setIsSavingProduct).mock.calls.filter(([v]: [boolean]) => v === false).length;
      expect(trueCount).toBe(2); // one per handleProductSelect call
      expect(falseCount).toBe(1); // only p-2's finally fires (p-1's was aborted)

      // Resolve the aborted first.
      await act(async () => {
        first.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });

      // Aborted first's finally must NOT add another false (its abort branch skips it).
      const falseCountAfter = vi.mocked(params.setIsSavingProduct).mock.calls.filter(([v]: [boolean]) => v === false).length;
      expect(falseCountAfter).toBe(1);
    });
  });

  describe("unmount cleanup", () => {
    it("aborts the in-flight controller on unmount", async () => {
      const params = makeParams();
      const def = deferred<ReturnType<typeof makeProductSavedResponse>>();
      vi.mocked(saveRoomPreviewSessionProduct).mockReturnValue(def.promise);

      const { result, unmount } = renderHook(() => useProductSelection(params));

      await act(async () => { result.current.handleProductSelect("p-1"); });
      const signal = vi.mocked(saveRoomPreviewSessionProduct).mock.calls[0][2]?.signal as AbortSignal;
      expect(signal.aborted).toBe(false);

      unmount();

      expect(signal.aborted).toBe(true);

      // Resolve to clean up the dangling promise.
      await act(async () => {
        def.resolve(makeProductSavedResponse("p-1"));
        await flushMicrotasks();
      });
    });
  });
});
