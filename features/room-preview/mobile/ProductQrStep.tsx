"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, LoaderCircle, QrCode, RotateCcw } from "lucide-react";
import { parseProductCodeFromQrValue } from "@/lib/room-preview/product-qr";
import { useI18n } from "@/lib/i18n/provider";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import type {
  RoomPreviewProduct,
  SelectedProductsBySurface,
  TargetSurface,
} from "@/lib/room-preview/types";

type ProductLookupResponse =
  | {
      ok: true;
      product: RoomPreviewProduct;
    }
  | {
      ok: false;
      code?: string;
      error: string;
    };

type ProductQrStepProps = {
  initialProductCode?: string | null;
  isBusy: boolean;
  canUseProductListFallback: boolean;
  onUseProductListFallback: () => void;
  mode?: "initial" | "add" | "change";
  expectedSurface?: TargetSurface | null;
  selectedProductsBySurface?: SelectedProductsBySurface;
  onCancel?: () => void;
  onSaveProductCode?: (productCode: string) => Promise<void>;
  onGenerateWithProductCode: (productCode: string) => Promise<void>;
};

class ProductLookupError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "ProductLookupError";
    this.code = code;
  }
}

async function fetchProductByCode(productCode: string) {
  const response = await fetch(
    `/api/room-preview/mobile/products?code=${encodeURIComponent(productCode)}`,
    { cache: "no-store" },
  );
  const data = (await response.json()) as ProductLookupResponse;

  if (!response.ok || !data.ok) {
    if (data.ok) throw new ProductLookupError("Product not found.", "PRODUCT_NOT_FOUND");
    throw new ProductLookupError(data.error, data.code ?? null);
  }

  return data.product;
}

function lookupErrorMessage(error: unknown, isAr: boolean): string {
  const code = error instanceof ProductLookupError ? error.code : null;

  switch (code) {
    case "UNSUPPORTED_PRODUCT_CATEGORY":
      return isAr
        ? "هذا المنتج غير مدعوم في معاينة الغرفة حالياً."
        : "This product is not supported in room preview yet.";
    case "PRODUCT_IMAGE_MISSING":
      return isAr
        ? "لا توجد صورة معتمدة لهذا المنتج بعد."
        : "This product has no approved preview image yet.";
    case "PDC_UNAVAILABLE":
    case "PDC_AUTH_ERROR":
      return isAr
        ? "تعذر جلب بيانات المنتج حالياً. حاول مرة أخرى."
        : "Product lookup is temporarily unavailable. Please try again.";
    case "PRODUCT_NOT_FOUND":
      return isAr ? "لم يتم العثور على المنتج." : "Product was not found.";
    default:
      if (error instanceof Error && error.message) return error.message;
      return isAr ? "لم يتم العثور على المنتج." : "Product was not found.";
  }
}

function surfaceLabels(isAr: boolean) {
  return {
    floor: isAr ? "الأرضية" : "flooring",
    walls: isAr ? "ورق الجدران" : "wallpaper",
  } satisfies Record<TargetSurface, string>;
}

// Custom scan-frame guide, drawn with plain CSS corner brackets instead of
// relying on qr-scanner's own highlightScanRegion/highlightCodeOutline SVG
// overlay — that overlay is positioned against the raw video element and gets
// clipped by this preview's rounded, overflow-hidden container (showing up as
// stray vertical slivers instead of full "L" corners). #e9b213 matches the
// library's own default highlight color, so the look is unchanged.
//
// Each corner is two independent rounded bars (one horizontal, one vertical)
// anchored flush (0 offset — no inset) to that corner of the scan-area square,
// so they sit exactly on the square's own boundary — never inside or outside
// it — regardless of the camera container's size.
function ScanFrameOverlay() {
  const bar = "absolute rounded-full bg-[#e9b213]";
  const h = `${bar} h-1 w-7`; // 4px thick, 28px long — horizontal leg
  const v = `${bar} h-7 w-1`; // 28px long, 4px thick — vertical leg
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {/* Sized from height, not width: this camera container is a short,
          wide rectangle (min-h-[180px], full width). A width-based square
          (70% of ~320px ≈ 224px) is taller than the ~178px-tall container
          and gets clipped top/bottom by its overflow-hidden. Height is
          always the smaller dimension here, so a height-based square never
          exceeds the container in either axis. */}
      <div className="absolute left-1/2 top-1/2 aspect-square h-[70%] -translate-x-1/2 -translate-y-1/2 overflow-visible">
        {/* top-left */}
        <span className={`${h} left-0 top-0`} />
        <span className={`${v} left-0 top-0`} />
        {/* top-right */}
        <span className={`${h} right-0 top-0`} />
        <span className={`${v} right-0 top-0`} />
        {/* bottom-left */}
        <span className={`${h} bottom-0 left-0`} />
        <span className={`${v} bottom-0 left-0`} />
        {/* bottom-right */}
        <span className={`${h} bottom-0 right-0`} />
        <span className={`${v} bottom-0 right-0`} />
      </div>
    </div>
  );
}

export default function ProductQrStep({
  initialProductCode,
  isBusy,
  canUseProductListFallback,
  onUseProductListFallback,
  mode = "initial",
  expectedSurface = null,
  selectedProductsBySurface,
  onCancel,
  onSaveProductCode,
  onGenerateWithProductCode,
}: ProductQrStepProps) {
  const { locale } = useI18n();
  const isAr = locale === "ar";
  const surfaceLabel = surfaceLabels(isAr);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(null);
  const handledScanRef = useRef<string | null>(null);

  const [scannerStatus, setScannerStatus] = useState<"idle" | "starting" | "scanning">("idle");
  const [product, setProduct] = useState<RoomPreviewProduct | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopScanner = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setScannerStatus("idle");
  }, []);

  const handleScannedValue = useCallback(
    async (value: string) => {
      const productCode = parseProductCodeFromQrValue(value);

      if (!productCode) {
        setError(isAr ? "هذا الرمز ليس QR منتج." : "This QR code is not a product QR.");
        return;
      }

      if (handledScanRef.current === productCode) return;
      handledScanRef.current = productCode;
      setIsLookingUp(true);
      setError(null);

      console.info("[room-preview] qr_product_detected", { productCode, t: Date.now() });

      try {
        const nextProduct = await fetchProductByCode(productCode);
        console.info("[room-preview] qr_product_resolved", {
          productCode,
          productId: nextProduct.id,
          t: Date.now(),
        });
        setProduct(nextProduct);
        stopScanner();
      } catch (lookupError) {
        handledScanRef.current = null;
        setProduct(null);
        setError(lookupErrorMessage(lookupError, isAr));
      } finally {
        setIsLookingUp(false);
      }
    },
    [isAr, stopScanner],
  );

  useEffect(() => {
    if (!initialProductCode || product?.id === initialProductCode) return;
    void handleScannedValue(initialProductCode);
  }, [handleScannedValue, initialProductCode, product?.id]);

  useEffect(() => stopScanner, [stopScanner]);

  const startScanner = async () => {
    if (!videoRef.current || scannerStatus !== "idle") return;

    setScannerStatus("starting");
    setError(null);

    try {
      const { default: QrScanner } = await import("qr-scanner");
      const hasCamera = await QrScanner.hasCamera();
      if (!hasCamera) {
        throw new Error(isAr ? "لم يتم العثور على كاميرا في هذا الجهاز." : "No camera was found on this device.");
      }

      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          void handleScannedValue(result.data);
        },
        {
          preferredCamera: "environment",
          // Visual-only flags — detection/decoding is unaffected. Turned off
          // in favor of the custom <ScanFrameOverlay /> below, which doesn't
          // get clipped by this preview's rounded/overflow-hidden container.
          highlightScanRegion: false,
          highlightCodeOutline: false,
          maxScansPerSecond: 8,
          returnDetailedScanResult: true,
        },
      );

      scannerRef.current = scanner;
      await scanner.start();
      setScannerStatus("scanning");
    } catch (scanError) {
      scannerRef.current?.destroy();
      scannerRef.current = null;
      setScannerStatus("idle");
      setError(
        scanError instanceof Error
          ? scanError.message
          : isAr
            ? "تعذر تشغيل الكاميرا."
            : "Camera scanning could not be started.",
      );
    }
  };

  const resetProduct = () => {
    handledScanRef.current = null;
    setProduct(null);
    setError(null);
  };

  // Generic wording only — the second product is never pre-labelled as
  // wallpaper/wall: any supported product type may be added later.
  const modeTitle =
    mode === "add"
      ? isAr
        ? "اختيار منتج آخر"
        : "Choose another product"
      : mode === "change" && expectedSurface
        ? isAr
          ? `تغيير ${surfaceLabel[expectedSurface]}`
          : `Change ${surfaceLabel[expectedSurface]}`
        : isAr
          ? "اختيار المنتج"
          : "Select the product";
  const modeDescription =
    mode === "add"
      ? isAr
        ? "وجّه الكاميرا إلى QR المنتج الآخر، وسيتم تحديد النوع تلقائياً من بيانات المنتج."
        : "Point the camera at the other product's QR. Its type is detected from product data."
      : mode === "change" && expectedSurface
        ? isAr
          ? `اختر منتجاً مناسباً لـ ${surfaceLabel[expectedSurface]} فقط.`
          : `Choose a product for ${surfaceLabel[expectedSurface]} only.`
        : isAr
          ? "افتح الكاميرا ووجهها إلى QR المطبوع على المنتج."
          : "Open the camera and point it at the printed QR on the physical product.";

  const expectedMismatch =
    product && mode === "change" && expectedSurface && product.targetSurface !== expectedSurface;
  const duplicateProduct =
    product && selectedProductsBySurface?.[product.targetSurface]?.id === product.id;
  const existingProductOnSurface = product ? selectedProductsBySurface?.[product.targetSurface] : null;
  const requiresReplaceConfirmation =
    mode === "add" && Boolean(existingProductOnSurface && !duplicateProduct);
  const actionLabel =
    mode === "initial"
      ? onSaveProductCode
        ? isAr
          ? "متابعة"
          : "Continue"
        : isAr
          ? "إنشاء"
          : "Generate"
      : mode === "add" && requiresReplaceConfirmation
        ? isAr
          ? "استبدال"
          : "Replace"
        : mode === "add"
          ? isAr
            ? "إضافة المنتج"
            : "Add product"
          : isAr
            ? "استبدال"
            : "Replace";

  const handlePrimaryAction = async () => {
    if (!product || expectedMismatch || duplicateProduct) return;
    if (mode === "initial") {
      // Save-only when the parent provides it: the user lands on the
      // selected-products page where they can add a second product before
      // generating. Generating directly is kept as a fallback contract.
      if (onSaveProductCode) {
        await onSaveProductCode(product.id);
        return;
      }
      await onGenerateWithProductCode(product.id);
      return;
    }
    await onSaveProductCode?.(product.id);
  };

  // Single scroll boundary: the whole step (header + content + footer) scrolls
  // together as one column when it doesn't fit — nothing scrolls on its own.
  // Content still grows via flex-1 to push the footer to the bottom on
  // roomy screens, but it no longer clips/scrolls independently, so a tall
  // found-product card (e.g. with a mismatch/replace banner) on shorter
  // phones no longer gets boxed into its own internal scrollbar — the whole
  // page scrolls instead.
  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-y-auto overscroll-contain text-center"
      data-mobile-step="scan_product_qr"
    >
      <div className="mx-auto flex w-full max-w-[345px] flex-col">
        {/* Header */}
        <div className="flex-none pb-3 pt-14">
          <h2 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
            {modeTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-6 text-[var(--text-secondary)]">
            {modeDescription}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 py-1">
          {!product ? (
            <div className="group flex w-full flex-col items-center justify-center gap-4 rounded-[40px] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)] transition-all duration-300">
              <div className="relative flex min-h-[180px] w-full overflow-hidden rounded-[32px] border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.05]">
                <video
                  ref={videoRef}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    scannerStatus === "idle" ? "opacity-0" : "opacity-100"
                  }`}
                  muted
                  playsInline
                />

                {scannerStatus === "scanning" ? <ScanFrameOverlay /> : null}

                {scannerStatus === "idle" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <QrCode className="size-9 text-[var(--brand-cyan)]" strokeWidth={2.1} />
                    <p className="text-sm font-semibold text-[var(--text-secondary)]">
                      {isAr ? "QR المنتج" : "Product QR"}
                    </p>
                  </div>
                ) : null}

                {scannerStatus === "starting" || isLookingUp ? (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--bg-page)]/80 backdrop-blur-sm">
                    <LoaderCircle className="size-7 animate-spin text-[var(--brand-cyan)]" />
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">
                      {isLookingUp
                        ? isAr
                          ? "جاري التحقق من المنتج..."
                          : "Checking product..."
                        : isAr
                          ? "جاري فتح الكاميرا..."
                          : "Opening camera..."}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="flex w-full flex-col items-center justify-center gap-4 rounded-[40px] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)] transition-all duration-300">
                <div className="flex min-h-[180px] w-full flex-col items-center justify-center gap-3 rounded-[32px] border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.05] px-6 py-6">
                  <div className="relative aspect-square w-full max-w-[160px] overflow-hidden rounded-[24px] border border-[var(--border)] bg-white">
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      fill
                      unoptimized
                      className="object-contain p-3"
                      sizes="160px"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-2 text-[var(--brand-cyan)]">
                    <QrCode className="size-5" />
                    <span className="text-sm font-semibold">
                      {isAr ? "تم العثور على المنتج" : "Product found"}
                    </span>
                  </div>
                  <p className="break-all font-mono text-2xl font-black text-[var(--text-primary)]">
                    {product.id}
                  </p>
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">
                    {surfaceLabel[product.targetSurface]}
                  </p>
                </div>
              </div>

              {expectedMismatch ? (
                <p className="mt-4 w-full rounded-[18px] border border-amber-400/30 bg-amber-50 px-4 py-3 text-center text-sm leading-6 text-amber-800">
                  {isAr
                    ? "هذا المنتج مخصص لسطح مختلف. يرجى اختيار منتج مناسب."
                    : "This product is for a different surface. Please choose a matching product."}
                </p>
              ) : duplicateProduct ? (
                <p className="mt-4 w-full rounded-[18px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center text-sm leading-6 text-[var(--text-secondary)]">
                  {isAr ? "هذا المنتج مختار مسبقاً." : "This product is already selected."}
                </p>
              ) : requiresReplaceConfirmation ? (
                <p className="mt-4 w-full rounded-[18px] border border-amber-400/30 bg-amber-50 px-4 py-3 text-center text-sm leading-6 text-amber-800">
                  {isAr
                    ? "يوجد منتج مختار مسبقاً لهذا السطح. هل تريد استبداله؟"
                    : "A product is already selected for this surface. Replace it?"}
                </p>
              ) : null}
            </>
          )}

          {error ? (
            <p className="mt-4 w-full rounded-[18px] border border-red-400/25 bg-red-50 px-4 py-3 text-center text-sm leading-6 text-red-700 dark:bg-red-500/08 dark:text-red-300">
              {error}
            </p>
          ) : null}

          {canUseProductListFallback ? (
            <button
              type="button"
              onClick={onUseProductListFallback}
              className="mt-4 text-xs font-semibold text-[var(--text-muted)] underline underline-offset-4"
            >
              {isAr ? "استخدام قائمة المنتجات القديمة" : "Use old product list fallback"}
            </button>
          ) : null}
        </div>

        {/* Footer — action buttons stay pinned to the bottom */}
        <div className="flex flex-none flex-col gap-3 pb-1 pt-3">
          {!product ? (
            <>
              <MobileActionButton
                variant="light"
                onClick={() => void startScanner()}
                disabled={isBusy || isLookingUp || scannerStatus !== "idle"}
                icon={
                  scannerStatus === "starting" || isLookingUp ? (
                    <LoaderCircle className="size-5 animate-spin" />
                  ) : (
                    <Camera className="size-5" />
                  )
                }
              >
                {scannerStatus === "scanning"
                  ? isAr
                    ? "جاري المسح..."
                    : "Scanning..."
                  : isAr
                    ? "فتح الكاميرا"
                    : "Open camera"}
              </MobileActionButton>

              {scannerStatus === "scanning" ? (
                <button
                  type="button"
                  onClick={stopScanner}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-2)]"
                >
                  <RotateCcw className="size-4" />
                  {isAr ? "إيقاف الكاميرا" : "Stop camera"}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <MobileActionButton
                variant="light"
                onClick={() => void handlePrimaryAction()}
                loading={isBusy}
                disabled={Boolean(expectedMismatch || duplicateProduct)}
              >
                {actionLabel}
              </MobileActionButton>
              <button
                type="button"
                onClick={resetProduct}
                disabled={isBusy}
                className="h-12 w-full rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-2)] disabled:opacity-50"
              >
                {isAr ? "اختيار منتج آخر" : "Choose another product"}
              </button>
            </>
          )}

          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              className="h-12 w-full rounded-[24px] border border-[var(--border)] bg-transparent text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] disabled:opacity-50"
            >
              {isAr ? "إلغاء" : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
