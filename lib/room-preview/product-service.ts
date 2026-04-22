import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import {
  fetchRoomPreviewSession,
  requestRoomPreviewJson,
  RoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import type {
  SaveRoomPreviewSessionProductResponse,
  SaveRoomPreviewSessionProductResult,
} from "@/lib/room-preview/types";
import {
  assertValidResponse,
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

export async function saveRoomPreviewSessionProduct(
  sessionId: string,
  options:
    | {
        barcode: string;
      }
    | {
        productId: string;
      },
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
    },
    "Could not save the selected product for this session.",
  );

  const saveResponse = assertProductSaveResponse(data);
  const session = await fetchRoomPreviewSession(sessionId);
  const selectedProduct = session.selectedProduct;

  if (!selectedProduct?.id || !selectedProduct.imageUrl) {
    console.error("[room-preview] Missing product state after save", {
      reloadedProduct: selectedProduct,
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
      reloadedProduct: selectedProduct,
      sessionId,
    });

    throw new RoomPreviewRequestError("server", "Failed to save product. Please try again.");
  }

  if ("barcode" in options && selectedProduct.barcode !== options.barcode) {
    console.error("[room-preview] Product barcode mismatch after save", {
      expectedBarcode: options.barcode,
      reloadedProduct: selectedProduct,
      sessionId,
    });

    throw new RoomPreviewRequestError("server", "Failed to save product. Please try again.");
  }

  return {
    product: saveResponse.product,
    session,
  } satisfies SaveRoomPreviewSessionProductResult;
}
