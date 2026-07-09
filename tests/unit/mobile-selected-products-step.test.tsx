// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type {
  RoomPreviewProduct,
  RoomPreviewSession,
  SelectedProduct,
  SelectedProductsBySurface,
} from "@/lib/room-preview/types";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt?: string; src?: string }) => <img alt={alt} src={src} />,
}));

const localeState = vi.hoisted(() => ({ current: "en" as "ar" | "en" }));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ locale: localeState.current }),
}));

vi.mock("@/components/ui/particle-button", () => ({
  useParticleBurst: () => ({ burst: vi.fn(), particles: null }),
}));

import SelectedProductsStep from "@/features/room-preview/mobile/SelectedProductsStep";
import ProductQrStep from "@/features/room-preview/mobile/ProductQrStep";

const floorProduct: SelectedProduct = {
  id: "PARQ.001",
  barcode: null,
  name: "Oak flooring",
  productType: "floor_material",
  category: "PARQUET",
  targetSurface: "floor",
  imageUrl: "/qr-products/parquet/PARQ.001.jpg",
};

const wallpaperProduct: SelectedProduct = {
  id: "WPT01.1104-1",
  barcode: null,
  name: "Ivory wallpaper",
  productType: "wall_material",
  category: "WALLPAPER",
  targetSurface: "walls",
  imageUrl: "/qr-products/wallpaper/WPT01.1104-1.jpg",
};

function makeSession(selectedProductsBySurface?: SelectedProductsBySurface): RoomPreviewSession {
  return {
    id: "session-1",
    status: "product_selected",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    mobileConnected: true,
    selectedRoom: { source: "camera", imageUrl: "/room.jpg" },
    selectedProduct: selectedProductsBySurface?.floor ?? selectedProductsBySurface?.walls ?? null,
    selectedProductsBySurface,
    renderResult: null,
  };
}

function renderSelectedProducts(
  session: RoomPreviewSession,
  overrides: Partial<ComponentProps<typeof SelectedProductsStep>> = {},
) {
  return render(
    <SelectedProductsStep
      session={session}
      locale="en"
      isBusy={false}
      onAddAnother={vi.fn()}
      onChangeSurface={vi.fn()}
      onRemoveSurface={vi.fn()}
      onCreateRender={vi.fn()}
      {...overrides}
    />,
  );
}

function productLookupResponse(product: RoomPreviewProduct) {
  return new Response(JSON.stringify({ ok: true, product }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localeState.current = "en";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SelectedProductsStep", () => {
  it("renders one selected product card and allows one-product render", () => {
    const onCreateRender = vi.fn();
    renderSelectedProducts(makeSession({ floor: floorProduct }), { onCreateRender });

    expect(screen.getByText("Flooring")).toBeTruthy();
    expect(screen.getByText("PARQ.001")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Add another product/i }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Generate preview/i }));
    expect(onCreateRender).toHaveBeenCalledTimes(1);
  });

  it("renders floor and wallpaper cards, disables add another, and allows two-product render", () => {
    const onCreateRender = vi.fn();
    renderSelectedProducts(makeSession({ floor: floorProduct, walls: wallpaperProduct }), {
      onCreateRender,
    });

    expect(screen.getByText("Flooring")).toBeTruthy();
    expect(screen.getByText("Wallpaper")).toBeTruthy();
    expect(screen.getByText("PARQ.001")).toBeTruthy();
    expect(screen.getByText("WPT01.1104-1")).toBeTruthy();

    expect((screen.getByRole("button", { name: /Flooring and wallpaper selected/i }) as HTMLButtonElement).disabled).toBe(true);
    const renderButton = screen.getByRole("button", { name: /Generate preview/i });
    expect((renderButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(renderButton);
    expect(onCreateRender).toHaveBeenCalledTimes(1);
  });

  it("calls remove and change for a surface without removing the other card locally", () => {
    const onRemoveSurface = vi.fn();
    const onChangeSurface = vi.fn();
    renderSelectedProducts(makeSession({ floor: floorProduct, walls: wallpaperProduct }), {
      onRemoveSurface,
      onChangeSurface,
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Remove/i })[0]);
    expect(onRemoveSurface).toHaveBeenCalledWith("floor");
    expect(screen.getByText("WPT01.1104-1")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Change/i })[1]);
    expect(onChangeSurface).toHaveBeenCalledWith("walls");
    expect(screen.getByText("PARQ.001")).toBeTruthy();
  });

  it("falls back to legacy selectedProduct and shows Arabic RTL surface labels", () => {
    const legacySession = makeSession(undefined);
    legacySession.selectedProduct = wallpaperProduct;

    renderSelectedProducts(legacySession, { locale: "ar" });

    expect(screen.getByText("ورق الجدران")).toBeTruthy();
    expect(screen.getByText("WPT01.1104-1")).toBeTruthy();
  });
});

describe("ProductQrStep", () => {
  it("shows the Arabic wrong-surface message in change mode and disables saving", async () => {
    localeState.current = "ar";
    vi.mocked(fetch).mockResolvedValue(productLookupResponse(wallpaperProduct as RoomPreviewProduct));
    const onSaveProductCode = vi.fn();

    render(
      <ProductQrStep
        initialProductCode="WPT01.1104-1"
        isBusy={false}
        canUseProductListFallback={false}
        onUseProductListFallback={vi.fn()}
        mode="change"
        expectedSurface="floor"
        selectedProductsBySurface={{ floor: floorProduct }}
        onSaveProductCode={onSaveProductCode}
        onGenerateWithProductCode={vi.fn()}
      />,
    );

    expect(await screen.findByText("هذا المنتج مخصص لسطح مختلف. يرجى مسح منتج مناسب.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "استبدال" }));
    expect(onSaveProductCode).not.toHaveBeenCalled();
  });

  it("shows replace confirmation when add mode scans an occupied surface", async () => {
    localeState.current = "ar";
    const replacementWallpaper = {
      ...wallpaperProduct,
      id: "WPT01.2201-2",
      imageUrl: "/qr-products/wallpaper/WPT01.2201-2.jpg",
    } satisfies SelectedProduct;
    vi.mocked(fetch).mockResolvedValue(productLookupResponse(replacementWallpaper as RoomPreviewProduct));
    const onSaveProductCode = vi.fn().mockResolvedValue(undefined);

    render(
      <ProductQrStep
        initialProductCode="WPT01.2201-2"
        isBusy={false}
        canUseProductListFallback={false}
        onUseProductListFallback={vi.fn()}
        mode="add"
        selectedProductsBySurface={{ walls: wallpaperProduct }}
        onSaveProductCode={onSaveProductCode}
        onGenerateWithProductCode={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("يوجد منتج مختار مسبقاً لهذا السطح. هل تريد استبداله؟"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "استبدال" }));
    await waitFor(() => expect(onSaveProductCode).toHaveBeenCalledWith("WPT01.2201-2"));
  });
});
