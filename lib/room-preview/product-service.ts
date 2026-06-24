import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import {
  requestRoomPreviewJson,
  RoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import type {
  SaveRoomPreviewSessionProductResponse,
  SaveRoomPreviewSessionProductResult,
  RemoveRoomPreviewSessionProductResponse,
  TargetSurface,
} from "@/lib/room-preview/types";
import {
  assertValidResponse,
  isRoomPreviewSession,
  isSelectedProduct,
  isSaveRoomPreviewSessionProductResponse,
} from "@/lib/room-preview/validators";

function assertProductSaveResponse(data: unknown) {
  try {
    return assertValidResponse<SaveRoomPreviewSessionProductResponse>(
      data,
      isSaveRoomPreviewSessionProductResponse,
      "The server returned an invalid product selection response.",
    );
  } catch {
    throw new RoomPreviewRequestError(
      "invalid_response",
      "The server returned an invalid product selection response.",
    );
  }
}

function isRemoveRoomPreviewSessionProductResponse(
  value: unknown,
): value is RemoveRoomPreviewSessionProductResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    ((value as { product?: unknown }).product === null ||
      isSelectedProduct((value as { product?: unknown }).product)) &&
    isRoomPreviewSession((value as { session?: unknown }).session)
  );
}

function assertProductRemoveResponse(data: unknown) {
  try {
    return assertValidResponse<RemoveRoomPreviewSessionProductResponse>(
      data,
      isRemoveRoomPreviewSessionProductResponse,
      "The server returned an invalid product removal response.",
    );
  } catch {
    throw new RoomPreviewRequestError(
      "invalid_response",
      "The server returned an invalid product removal response.",
    );
  }
}

export async function saveRoomPreviewSessionProduct(
  sessionId: string,
  options:
    | {
        barcode: string;
      }
    | {
        productId: string;
      }
    | {
        productCode: string;
      },
  { signal }: { signal?: AbortSignal } = {},
) {
  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.productApi(sessionId),
    {
      method: "POST",
      body: JSON.stringify(options),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      ...(signal ? { signal } : {}),
    },
    "Could not save the selected product for this session.",
  );

  const saveResponse = assertProductSaveResponse(data);
  const session = saveResponse.session;
  const selectedProduct = saveResponse.product;

  if (!selectedProduct?.id || !selectedProduct.imageUrl) {
    console.error("[room-preview] Missing product state after save", {
      reloadedProduct: session.selectedProduct,
      requestedSelection: options,
      savedProduct: saveResponse.product,
      sessionId,
      status: session.status,
    });

    throw new RoomPreviewRequestError("server", "Failed to save product. Please try again.");
  }

  if ("productId" in options && selectedProduct.id !== options.productId) {
    console.error("[room-preview] Product id mismatch after save", {
      expectedProductId: options.productId,
      reloadedProduct: session.selectedProduct,
      savedProduct: selectedProduct,
      sessionId,
    });

    throw new RoomPreviewRequestError("server", "Failed to save product. Please try again.");
  }

  if ("barcode" in options && selectedProduct.barcode !== options.barcode) {
    console.error("[room-preview] Product barcode mismatch after save", {
      expectedBarcode: options.barcode,
      reloadedProduct: session.selectedProduct,
      savedProduct: selectedProduct,
      sessionId,
    });

    throw new RoomPreviewRequestError("server", "Failed to save product. Please try again.");
  }

  if ("productCode" in options && selectedProduct.id !== options.productCode) {
    console.error("[room-preview] Product code mismatch after save", {
      expectedProductCode: options.productCode,
      reloadedProduct: session.selectedProduct,
      savedProduct: selectedProduct,
      sessionId,
    });

    throw new RoomPreviewRequestError("server", "Failed to save product. Please try again.");
  }

  return {
    product: saveResponse.product,
    session,
  } satisfies SaveRoomPreviewSessionProductResult;
}

export async function removeRoomPreviewSessionProduct(
  sessionId: string,
  surface: TargetSurface,
) {
  const data = await requestRoomPreviewJson(
    `${ROOM_PREVIEW_ROUTES.productApi(sessionId)}?surface=${encodeURIComponent(surface)}`,
    {
      method: "DELETE",
      cache: "no-store",
    },
    "Could not remove the selected product for this session.",
  );

  return assertProductRemoveResponse(data);
}
