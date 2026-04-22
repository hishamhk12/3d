"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { LoaderCircle, ScanBarcode } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { getProductTypeLabel } from "@/features/room-preview/shared/helpers";
import type { RoomPreviewProduct, SelectedProduct } from "@/lib/room-preview/types";
import { motion, AnimatePresence } from "framer-motion";

// ─── BarcodeDetector (Web API — Chrome/Edge/Android; Safari 17.4+) ────────────

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorAPI {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
declare const BarcodeDetector: {
  new(opts?: { formats?: string[] }): BarcodeDetectorAPI;
  getSupportedFormats?(): Promise<string[]>;
};

function isBarcodeDetectorAvailable() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProductStepProps {
  isSavingProduct: boolean;
  isScanning: boolean;
  products: RoomPreviewProduct[];
  selectedProduct: SelectedProduct | null;
  productCodeInput: string;
  onProductCodeInputChange: (v: string) => void;
  onBarcodeScanned: (rawValue: string) => void;
  onCodeSubmit: () => void;
  onProductSelect: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductStep({
  isSavingProduct,
  isScanning,
  products,
  selectedProduct,
  productCodeInput,
  onProductCodeInputChange,
  onBarcodeScanned,
  onCodeSubmit,
  onProductSelect,
}: ProductStepProps) {
  const { dir, locale, t } = useI18n();
  const sectionAlignClass = dir === "rtl" ? "text-right" : "text-left";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const handleCameraCapture = useCallback(async (file: File) => {
    setCameraError(null);
    if (!isBarcodeDetectorAvailable()) {
      setCameraError(t.roomPreview.mobile.product.scanNotSupported);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector();
      const codes = await detector.detect(bitmap);
      bitmap.close();
      if (codes.length === 0) {
        setCameraError(t.roomPreview.mobile.product.productNotFound);
        return;
      }
      onBarcodeScanned(codes[0].rawValue);
    } catch {
      setCameraError(t.roomPreview.mobile.product.scanNotSupported);
    }
  }, [t, onBarcodeScanned]);

  const handleScanClick = useCallback(() => {
    setCameraError(null);
    if (!isBarcodeDetectorAvailable()) {
      setCameraError(t.roomPreview.mobile.product.scanNotSupported);
      return;
    }
    fileInputRef.current?.click();
  }, [t]);

  return (
    <section className={`mt-8 rounded-[28px] border border-[rgba(255,255,255,0.8)] bg-white/75 backdrop-blur-md p-5 ${sectionAlignClass}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-[#003C71] uppercase" style={{ textShadow: "0 1px 1px rgba(255,255,255,0.7)" }}>
            {t.roomPreview.mobile.product.eyebrow}
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-[#1d1d1f]">
            {t.roomPreview.mobile.product.title}
          </h2>
        </div>
        {isSavingProduct ? (
          <div className="inline-flex items-center gap-2 text-sm" style={{ color: "#003C71" }}>
            <LoaderCircle className="size-4 animate-spin" />
            {t.common.actions.saving}
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        {/* Product Viewer Layout (Match /test-product) */}
        <div className="mt-8 flex flex-col items-center w-full">
            {/* Main Image Container */}
            <div className="relative w-full h-[45vh] min-h-[300px] flex items-center justify-center mb-10 group perspective-1000">
              {/* Soft floating ambient background light behind the image for depth */}
              <div className="absolute inset-0 max-w-[200px] mx-auto bg-white/70 blur-[70px] -z-10 rounded-[100%] opacity-80 pointer-events-none transition-all duration-700 ease-out group-hover:scale-110 group-hover:bg-white/90" />

              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedProduct?.id || (products[0] && products[0].id) || 'empty'}
                  initial={{ opacity: 0, scale: 0.92, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 1.05, y: -10 }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full relative z-10 flex items-center justify-center w-full"
                >
                  {(selectedProduct || products[0]) ? (
                    <img
                      src={(selectedProduct || products[0]).imageUrl ?? undefined}
                      alt="Premium Product Preview"
                      className="w-auto h-full object-contain transition-all duration-500 drop-shadow-[0_20px_25px_rgba(0,0,0,0.12)] group-hover:drop-shadow-[0_35px_45px_rgba(0,0,0,0.18)]"
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
              
              {/* Info Overlay */}
              {(selectedProduct || products[0]) && (selectedProduct || products[0]).barcode && (
                <div className="absolute bottom-0 w-full flex justify-center pointer-events-none z-20 translate-y-1/2">
                  <div className="bg-white/85 backdrop-blur-md px-5 py-2.5 rounded-full shadow-[0_8px_16px_rgba(0,32,64,0.06)] border border-white/60 flex flex-col items-center">
                    <p className="text-sm font-bold text-[#1d1d1f]">{(selectedProduct || products[0]).barcode}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Thumbnails Container */}
            <div className="flex gap-4 overflow-x-auto w-[calc(100%+40px)] -mx-5 px-5 pb-8 snap-x scrollbar-hide shrink-0 items-center" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <style dangerouslySetInnerHTML={{__html: ` .scrollbar-hide::-webkit-scrollbar { display: none; } `}} />
              
              {products.map((product) => {
                const isActive = (selectedProduct?.id || products[0]?.id) === product.id;
                return (
                  <button
                    key={product.id}
                    onClick={() => void onProductSelect(product.id)}
                    disabled={isSavingProduct}
                    type="button"
                    className={`relative shrink-0 snap-center transition-all duration-500 ease-out group/thumb outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive 
                        ? 'scale-110 opacity-100 z-10 px-2' 
                        : 'scale-95 opacity-50 hover:opacity-100 hover:scale-100 z-0'
                    }`}
                  >
                    {/* Thumbnail Card */}
                    <div className={`w-16 h-28 flex items-center justify-center p-2 rounded-xl transition-all duration-500 ${
                      isActive 
                        ? 'bg-white shadow-[0_8px_20px_rgba(0,0,0,0.08)] ring-1 ring-black/10' 
                        : 'bg-white/40 shadow-sm group-hover/thumb:bg-white/80 group-hover/thumb:shadow-md'
                    }`}>
                      <img 
                        src={product.imageUrl} 
                        alt="Product Thumbnail" 
                        className="w-full h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.1)] transition-transform duration-500 group-hover/thumb:scale-105"
                      />
                    </div>
                    
                    {/* Active Indicator Dot */}
                    {isActive && (
                      <motion.div 
                        layoutId="active-product-dot"
                        className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#003C71]"
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
        </div>
      </div>
    </section>
  );
}
