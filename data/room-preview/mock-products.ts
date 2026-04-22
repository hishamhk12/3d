import "server-only";

import type { MockRoomPreviewProduct } from "@/lib/room-preview/types";

const PQC201_PRODUCTS: MockRoomPreviewProduct[] = [
  { id: "PQC201-001", barcode: "PQC201001", name: "باركيه رمادي كلاسيك",  productType: "floor_material", imageUrl: "/PQC201-1220X180X6/PQC201.001-1.png" },
  { id: "PQC201-002", barcode: "PQC201002", name: "باركيه بني طبيعي",      productType: "floor_material", imageUrl: "/PQC201-1220X180X6/PQC201.002-1.png" },
  { id: "PQC201-004", barcode: "PQC201004", name: "باركيه أبيض ناصع",      productType: "floor_material", imageUrl: "/PQC201-1220X180X6/PQC201.004-1.png" },
  { id: "PQC201-006", barcode: "PQC201006", name: "باركيه رمادي فضي",      productType: "floor_material", imageUrl: "/PQC201-1220X180X6/PQC201.006-1.png" },
];

export function getRoomPreviewMockProducts(): MockRoomPreviewProduct[] {
  return PQC201_PRODUCTS;
}

export function getRoomPreviewMockProductById(productId: string) {
  return PQC201_PRODUCTS.find((p) => p.id === productId) ?? null;
}

export function getRoomPreviewMockProductByBarcode(barcode: string) {
  return PQC201_PRODUCTS.find((p) => p.barcode === barcode) ?? null;
}
