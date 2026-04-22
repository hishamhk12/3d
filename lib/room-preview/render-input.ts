import "server-only";

import { products, type Product } from "@/data/products";
import { getPromptForProductType } from "@/lib/room-preview/product-prompts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RenderInput = {
  product: Product;
  prompt: string;
  roomImage: string;
  productImage: string;
};

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildRenderInput(productCode: string, roomImage: string): RenderInput {
  const product = products.find((p) => p.code === productCode);
  if (!product) throw new Error(`Product not found: ${productCode}`);

  return {
    product,
    prompt: getPromptForProductType(product.type),
    roomImage,
    productImage: product.image,
  };
}
