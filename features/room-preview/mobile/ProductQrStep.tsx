"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, LoaderCircle, QrCode, RotateCcw } from "lucide-react";
import { parseProductCodeFromQrValue } from "@/lib/room-preview/product-qr";
import { useI18n } from "@/lib/i18n/provider";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

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
  onProductResolved?: (productCode: string) => void;
  onGenerateWithProductCode: (productCode: string) => Promise<void>;
};

async function fetchProductByCode(productCode: string) {
  const response = await fetch(
    `/api/room-preview/mobile/products?code=${encodeURIComponent(productCode)}`,
    { cache: "no-store" },
  );
  const data = (await response.json()) as ProductLookupResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.ok ? "Product not found." : data.error);
  }

  return data.product;
}


export default function ProductQrStep({
  initialProductCode,
  isBusy,
  canUseProductListFallback,
  onUseProductListFallback,
  onProductResolved,
  onGenerateWithProductCode,
}: ProductQrStepProps) {
  const { locale } = useI18n();
  const isAr = locale === "ar";
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
        setError("This QR code is not a product QR.");
        return;
      }

      if (handledScanRef.current === productCode) return;
      handledScanRef.current = productCode;
      setIsLookingUp(true);
      setError(null);

      console.info("[room-preview] qr_product_detected", { productCode, t: Date.now() });

      try {
        const nextProduct = await fetchProductByCode(productCode);
        console.info("[room-preview] qr_product_resolved", { productCode, productId: nextProduct.id, t: Date.now() });
        setProduct(nextProduct);
        onProductResolved?.(productCode);
        stopScanner();
      } catch (lookupError) {
        handledScanRef.current = null;
        setProduct(null);
        setError(lookupError instanceof Error ? lookupError.message : "Product was not found.");
      } finally {
        setIsLookingUp(false);
      }
    },
    [onProductResolved, stopScanner],
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
        throw new Error("No camera was found on this device.");
      }

      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          void handleScannedValue(result.data);
        },
        {
          preferredCamera: "environment",
          highlightScanRegion: true,
          highlightCodeOutline: true,
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
          : "Camera scanning could not be started.",
      );
    }
  };

  const resetProduct = () => {
    handledScanRef.current = null;
    setProduct(null);
    setError(null);
  };

  return (
    <section
      className="flex min-h-[calc(100svh-2.25rem)] w-full flex-col items-center justify-center py-6 text-center"
      data-mobile-step="scan_product_qr"
    >
      <div className="mx-auto flex w-full max-w-[345px] flex-col items-center">
        <h2 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
          {isAr ? "امسح QR المنتج" : "Scan the product QR"}
        </h2>
        <p className="mx-auto mt-3 max-w-xs text-center text-sm leading-7 text-[var(--text-secondary)]">
          {isAr
            ? "افتح الكاميرا ووجهها إلى QR المطبوع على المنتج."
            : "Open the camera and point it at the printed QR on the physical product."}
        </p>

        {!product ? (
          <>
            <div className="group mt-6 flex w-full flex-col items-center justify-center gap-4 rounded-[40px] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)] transition-all duration-300">
              <div className="relative flex min-h-[180px] w-full overflow-hidden rounded-[32px] border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.05]">
                <video
                  ref={videoRef}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                    scannerStatus === "idle" ? "opacity-0" : "opacity-100"
                  }`}
                  muted
                  playsInline
                />

                {scannerStatus === "idle" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    <QrCode className="size-9 text-[var(--brand-cyan)]" strokeWidth={2.1} />
                    <p className="text-sm font-semibold text-[var(--text-secondary)]">
                      {isAr ? "QR المنتج" : "Product QR"}
                    </p>
                  </div>
                ) : null}

                {scannerStatus === "starting" || isLookingUp ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-page)]/80 backdrop-blur-sm">
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

            <MobileActionButton
              variant="light"
              onClick={() => void startScanner()}
              disabled={isBusy || isLookingUp || scannerStatus !== "idle"}
              className="mt-5"
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
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-2)]"
              >
                <RotateCcw className="size-4" />
                {isAr ? "إيقاف الكاميرا" : "Stop camera"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="mt-6 flex w-full flex-col items-center justify-center gap-4 rounded-[40px] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)] transition-all duration-300">
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
                    {isAr ? "تم اختيار المنتج" : "Product QR found"}
                  </span>
                </div>
                <p className="break-all font-mono text-2xl font-black text-[var(--text-primary)]">
                  {product.id}
                </p>
              </div>
            </div>

            <MobileActionButton
              variant="light"
              onClick={() => void onGenerateWithProductCode(product.id)}
              loading={isBusy}
              className="mt-5"
            >
              {isAr ? "إنشاء" : "Generate"}
            </MobileActionButton>
            <button
              type="button"
              onClick={resetProduct}
              disabled={isBusy}
              className="mt-3 h-12 w-full rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-2)] disabled:opacity-50"
            >
              {isAr ? "مسح منتج آخر" : "Scan another product"}
            </button>
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
    </section>
  );
}
