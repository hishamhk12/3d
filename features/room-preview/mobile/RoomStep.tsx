"use client";

import Image from "next/image";
import { useRef } from "react";
import { ImagePlus, LoaderCircle, RefreshCw } from "lucide-react";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { useI18n } from "@/lib/i18n/provider";
import type { RoomPreviewRoomSource, SelectedRoom } from "@/lib/room-preview/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface RoomStepProps {
  isSavingRoom: boolean;
  roomSaveStatusLabel: string | null;
  selectedRoom: SelectedRoom | null;
  onFileSelection: (source: Extract<RoomPreviewRoomSource, "gallery">, file: File | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomStep({
  isSavingRoom,
  roomSaveStatusLabel,
  selectedRoom,
  onFileSelection,
}: RoomStepProps) {
  const { locale, t, dir } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (!isSavingRoom) inputRef.current?.click();
  };

  const hasPreview = Boolean(selectedRoom?.imageUrl);
  const isAr = locale === "ar";

  return (
    <section className={`mt-8 rounded-[28px] border border-[rgba(255,255,255,0.8)] bg-white/75 p-6 backdrop-blur-md ${dir === "rtl" ? "text-right" : "text-left"}`}>

      {/* Hidden native file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-hidden="true"
        disabled={isSavingRoom}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          onFileSelection("gallery", file);
          e.target.value = "";
        }}
      />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <p
        className="text-xs font-semibold tracking-[0.18em] text-[#003C71] uppercase"
        style={{ textShadow: "0 1px 1px rgba(255,255,255,0.7)" }}
      >
        {isAr ? "صورة الغرفة" : "Room Image"}
      </p>
      <h2 className="font-display mt-2 text-2xl font-semibold text-[#1d1d1f]">
        {isAr ? "ارفع صورة غرفتك" : "Upload your room image"}
      </h2>
      <p className="mt-3 text-sm leading-7 text-[#4a4a52]">
        {isAr ? "اختر صورة واضحة من معرض الهاتف لتجربة المنتج داخل مساحتك." : "Choose a clear photo from your gallery to experience the product in your space."}
      </p>

      {/* ── Upload tap area (no image selected yet) ───────────────────────── */}
      {!hasPreview ? (
        <AnimatedButton
          type="button"
          onClick={openPicker}
          disabled={isSavingRoom}
          aria-label={isAr ? "اختيار صورة من معرض الهاتف" : "Choose image from gallery"}
          className="mt-6 flex w-full flex-col items-center justify-center gap-4 rounded-[24px] border-2 border-dashed border-[rgba(0,60,113,0.25)] bg-white/50 py-12 transition-all duration-200 hover:border-[rgba(0,60,113,0.45)] hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSavingRoom ? (
            <>
              <LoaderCircle className="size-8 animate-spin text-[#003C71]" />
              <span className="text-sm font-semibold text-[#003C71]">
                {roomSaveStatusLabel ?? t.common.actions.loading}
              </span>
            </>
          ) : (
            <>
              <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-gradient-to-br from-[#003C71] to-[#0060b3] shadow-[0_6px_20px_rgba(0,60,113,0.30)]">
                <ImagePlus className="size-7 text-white" strokeWidth={1.75} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-base font-semibold text-[#1d1d1f]">
                  {isAr ? "اختيار صورة من المعرض" : "Select image from gallery"}
                </span>
                <span className="text-xs text-[#7a9ab5]">
                  {isAr ? "اضغط هنا للاختيار" : "Tap here to select"}
                </span>
              </div>
            </>
          )}
        </AnimatedButton>
      ) : null}

      {/* ── Preview (image selected) ───────────────────────────────────────── */}
      {hasPreview ? (
        <div className="mt-6">
          {/* Image thumbnail */}
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[20px] border border-[rgba(0,60,113,0.12)] shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
            <Image
              src={selectedRoom!.imageUrl!}
              alt={isAr ? "صورة الغرفة المختارة" : "Selected room image"}
              fill
              unoptimized
              className="object-cover"
            />
            {/* Saving overlay */}
            {isSavingRoom ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[20px] bg-white/85 backdrop-blur-sm">
                <LoaderCircle className="size-7 animate-spin text-[#003C71]" />
                <span className="text-sm font-semibold text-[#003C71]">
                  {roomSaveStatusLabel ?? t.common.actions.loading}
                </span>
              </div>
            ) : null}
          </div>

          {/* Change image button */}
          {!isSavingRoom ? (
            <AnimatedButton
              type="button"
              onClick={openPicker}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[20px] border border-[rgba(0,60,113,0.18)] bg-white/85 py-3 text-sm font-semibold text-[#003C71] backdrop-blur-sm transition-all duration-200 hover:bg-white/95"
            >
              <RefreshCw className="size-4" strokeWidth={2} />
              {isAr ? "تغيير الصورة" : "Change Image"}
            </AnimatedButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
