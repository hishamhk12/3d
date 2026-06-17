// Inventory domain types for the seller-chat UI — adapted from the chatbot's
// lib/inventory/types.ts. Only what the inventory CARDS need (no Prisma import,
// no datasheet/technical types). The same status rule as the rest of the system
// so the UI never invents a status the data wouldn't produce.

export const WAREHOUSES = ["Riyadh", "Jeddah", "Dammam"] as const;
export type Warehouse = (typeof WAREHOUSES)[number];

export type InventoryStatus = "available" | "low_stock" | "incoming" | "out_of_stock";

export const WAREHOUSE_AR: Record<string, string> = {
  Riyadh: "الرياض",
  Jeddah: "جدة",
  Dammam: "الدمام",
};

export const STATUS_AR: Record<InventoryStatus, string> = {
  available: "متوفر",
  low_stock: "كمية منخفضة",
  incoming: "قادم في الطريق",
  out_of_stock: "غير متوفر",
};

// The card-relevant shape returned by FastAPI `/internal/chat` in `cards`.
// All optional catalog fields stay nullable — the UI only renders what exists.
export interface InventoryDTO {
  id?: string;
  productCode: string;
  productName: string;
  category: string | null;
  marketingBasket?: string | null;
  design: string | null;
  size: string | null;
  classification: string | null;
  country?: string | null;
  warehouse: string;
  quantityAvailable: number;
  reservedQuantity: number;
  availableToSell: number;
  incomingQuantity: number;
  expectedArrivalDate: string | null;
  lastUpdated?: string | null;
  status: InventoryStatus;
  source?: string;
}

/** Status rule (mirrors the chatbot/FastAPI rule — no invented values). */
export function computeStatus(
  availableToSell: number,
  incomingQuantity: number,
): InventoryStatus {
  if (availableToSell > 10) return "available";
  if (availableToSell > 0) return "low_stock";
  if (incomingQuantity > 0) return "incoming";
  return "out_of_stock";
}
