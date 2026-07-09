import type {
  RoomPreviewSession,
  SelectedProduct,
  SelectedProductsBySurface,
  TargetSurface,
} from "@/lib/room-preview/types";

const SURFACES = ["floor", "walls"] as const satisfies readonly TargetSurface[];

function hasSelectedProductFields(product: SelectedProduct | null | undefined): product is SelectedProduct {
  return Boolean(product?.id && product.imageUrl && product.name);
}

function normalizeProductForSurface(product: SelectedProduct, surface: TargetSurface): SelectedProduct {
  return {
    ...product,
    productType: product.productType ?? (surface === "walls" ? "wall_material" : "floor_material"),
    category: product.category ?? (surface === "walls" ? "WALLPAPER" : "PARQUET"),
    targetSurface: surface,
  };
}

function surfaceForProduct(product: SelectedProduct): TargetSurface {
  return product.targetSurface ?? "floor";
}

export function getSelectedProductCount(products: SelectedProductsBySurface | null | undefined) {
  return SURFACES.reduce((count, surface) => count + (products?.[surface] ? 1 : 0), 0);
}

export function getSelectedProductCodes(products: SelectedProductsBySurface | null | undefined) {
  return SURFACES.map((surface) => products?.[surface]?.id).filter((id): id is string => Boolean(id));
}

export function getSelectedTargetSurfaces(products: SelectedProductsBySurface | null | undefined) {
  return SURFACES.filter((surface) => Boolean(products?.[surface]));
}

export function normalizeSelectedProducts(
  session: Pick<RoomPreviewSession, "selectedProduct" | "selectedProductsBySurface">,
): SelectedProductsBySurface {
  const current = session.selectedProductsBySurface;

  if (current) {
    const normalized: SelectedProductsBySurface = {};
    for (const surface of SURFACES) {
      const product = current[surface];
      if (hasSelectedProductFields(product)) {
        normalized[surface] = normalizeProductForSurface(product, surface);
      }
    }
    return normalized;
  }

  if (!hasSelectedProductFields(session.selectedProduct)) {
    return {};
  }

  const surface = surfaceForProduct(session.selectedProduct);
  return {
    [surface]: normalizeProductForSurface(session.selectedProduct, surface),
  };
}

export function getSelectedProducts(
  session: Pick<RoomPreviewSession, "selectedProduct" | "selectedProductsBySurface">,
) {
  return normalizeSelectedProducts(session);
}

export function getSelectedProductForSurface(
  session: Pick<RoomPreviewSession, "selectedProduct" | "selectedProductsBySurface">,
  surface: TargetSurface,
) {
  return normalizeSelectedProducts(session)[surface] ?? null;
}

export function upsertSelectedProductBySurface(
  current: SelectedProductsBySurface | null | undefined,
  product: SelectedProduct,
): SelectedProductsBySurface {
  const surface = surfaceForProduct(product);
  return {
    ...(current ?? {}),
    [surface]: normalizeProductForSurface(product, surface),
  };
}

export function removeSelectedProductBySurface(
  current: SelectedProductsBySurface | null | undefined,
  surface: TargetSurface,
): SelectedProductsBySurface {
  const next = { ...(current ?? {}) };
  delete next[surface];
  return next;
}

export function getPrimarySelectedProduct(
  current: SelectedProductsBySurface | null | undefined,
): SelectedProduct | null {
  return current?.floor ?? current?.walls ?? null;
}

export function getSelectedProductDiagnostics(
  current: SelectedProductsBySurface | null | undefined,
) {
  return {
    selectedProductCount: getSelectedProductCount(current),
    selectedProductCodes: getSelectedProductCodes(current),
    selectedTargetSurfaces: getSelectedTargetSurfaces(current),
  };
}

export const COMPOSITE_REFERENCE_ORDER = ["floor", "walls"] as const satisfies readonly TargetSurface[];

function isRenderableSurfaceProduct(product: SelectedProduct | null | undefined, surface: TargetSurface) {
  if (!hasSelectedProductFields(product)) {
    return false;
  }

  const normalized = normalizeProductForSurface(product, surface);
  return (
    normalized.targetSurface === surface &&
    ((surface === "floor" &&
      normalized.productType === "floor_material" &&
      normalized.category === "PARQUET") ||
      (surface === "walls" &&
        normalized.productType === "wall_material" &&
        normalized.category === "WALLPAPER"))
  );
}

export function isSupportedRenderProductCombination(
  products: SelectedProductsBySurface | null | undefined,
) {
  const selectedCount = getSelectedProductCount(products);
  if (selectedCount <= 1) {
    return true;
  }

  return (
    selectedCount === 2 &&
    isRenderableSurfaceProduct(products?.floor, "floor") &&
    isRenderableSurfaceProduct(products?.walls, "walls")
  );
}

export function getSelectedProductCategories(products: SelectedProductsBySurface | null | undefined) {
  return SURFACES.map((surface) => products?.[surface]?.category).filter(
    (category): category is NonNullable<SelectedProduct["category"]> => Boolean(category),
  );
}
