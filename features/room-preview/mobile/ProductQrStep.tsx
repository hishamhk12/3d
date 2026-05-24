"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, LoaderCircle, QrCode, RotateCcw } from "lucide-react";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { parseProductCodeFromQrValue } from "@/lib/room-preview/product-qr";
import { useI18n } from "@/lib/i18n/provider";
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
  onGenerateWithProductCode,
}: ProductQrStepProps) {
  const { dir, locale } = useI18n();
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

      try {
        const nextProduct = await fetchProductByCode(productCode);
        setProduct(nextProduct);
        stopScanner();
      } catch (lookupError) {
        handledScanRef.current = null;
        setProduct(null);
        setError(lookupError instanceof Error ? lookupError.message : "Product was not found.");
      } finally {
        setIsLookingUp(false);
      }
    },
    [stopScanner],
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

  const alignClass = dir === "rtl" ? "text-right" : "text-left";

  return (
    <section
      className={`mt-8 rounded-[28px] border border-[var(--border)] bg-[var(--bg-surface)] p-5 ${alignClass}`}
      data-mobile-step="scan_product_qr"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-cyan)]">
        {isAr ? "QR المنتج" : "Product QR"}
      </p>
      <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--text-primary)]">
        {isAr ? "امسح QR المنتج" : "Scan the product QR"}
      </h2>
      <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
        {isAr
          ? "افتح الكاميرا ووجهها إلى QR المطبوع على المنتج."
          : "Open the camera and point it at the printed QR on the physical product."}
      </p>

      {!product ? (
        <>
          <div className="mt-6 overflow-hidden rounded-[24px] border border-[var(--border)] bg-black">
            <video
              ref={videoRef}
              className="aspect-square w-full object-cover"
              muted
              playsInline
            />
          </div>

          <div className="mt-4 grid gap-3">
            <AnimatedButton
              type="button"
              onClick={() => void startScanner()}
              disabled={isBusy || isLookingUp || scannerStatus !== "idle"}
              className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[var(--brand-navy)] py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {scannerStatus === "starting" || isLookingUp ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
              {scannerStatus === "scanning"
                ? isAr ? "جاري المسح..." : "Scanning..."
                : isAr ? "فتح الكاميرا" : "Open camera"}
            </AnimatedButton>

            {scannerStatus === "scanning" ? (
              <button
                type="button"
                onClick={stopScanner}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface-2)] py-3 text-sm font-semibold text-[var(--text-secondary)]"
              >
                <RotateCcw className="size-4" />
                {isAr ? "إيقاف الكاميرا" : "Stop camera"}
              </button>
            ) : null}

          </div>
        </>
      ) : (
        <div className="mt-6 rounded-[24px] border border-[var(--border)] bg-[var(--bg-surface-2)] p-4 text-center">
          <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-[22px] border border-[var(--border)] bg-white">
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              unoptimized
              className="object-contain p-3"
              sizes="280px"
            />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-[var(--brand-cyan)]">
            <QrCode className="size-5" />
            <span className="text-sm font-semibold">
              {isAr ? "تم اختيار المنتج" : "Product QR found"}
            </span>
          </div>
          <p className="mt-2 break-all font-mono text-3xl font-black text-[var(--text-primary)]">
            {product.id}
          </p>

          <AnimatedButton
            type="button"
            onClick={() => void onGenerateWithProductCode(product.id)}
            disabled={isBusy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-[22px] bg-[var(--brand-gold)] py-4 text-lg font-black text-[var(--text-on-gold)] shadow-[var(--shadow-md)] disabled:opacity-50"
          >
            {isBusy ? <LoaderCircle className="size-5 animate-spin" /> : null}
            {isAr ? "إنشاء" : "Generate"}
          </AnimatedButton>
          <button
            type="button"
            onClick={resetProduct}
            disabled={isBusy}
            className="mt-3 w-full rounded-[18px] border border-[var(--border)] bg-[var(--bg-surface)] py-3 text-sm font-semibold text-[var(--text-secondary)] disabled:opacity-50"
          >
            {isAr ? "مسح منتج آخر" : "Scan another product"}
          </button>
        </div>
      )}

      {error ? (
        <p className="mt-4 rounded-[18px] border border-red-400/25 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/08 dark:text-red-300">
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
    </section>
  );
}
