"use client";

import Image from "next/image";
import { useRef } from "react";
import { ImagePlus, LoaderCircle, RefreshCw } from "lucide-react";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { useI18n } from "@/lib/i18n/provider";
import type { RoomPreviewRoomSource, SelectedRoom } from "@/lib/room-preview/types";

interface RoomStepProps {
  isSavingRoom: boolean;
  roomSaveStatusLabel: string | null;
  selectedRoom: SelectedRoom | null;
  onFileSelection: (source: Extract<RoomPreviewRoomSource, "gallery">, file: File | null) => void;
}

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
    <section className={`mt-8 rounded-[28px] border border-[var(--border)] bg-[var(--bg-surface)] p-6 ${dir === "rtl" ? "text-right" : "text-left"}`}>

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

      {/* Header */}
      <p className="text-xs font-semibold tracking-[0.18em] text-[var(--brand-cyan)] uppercase">
        {isAr ? "صورة الغرفة" : "Room Image"}
      </p>
      <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--text-primary)]">
        {isAr ? "ارفع صورة غرفتك" : "Upload your room image"}
      </h2>
      <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
        {isAr ? "اختر صورة واضحة من معرض الهاتف لتجربة المنتج داخل مساحتك." : "Choose a clear photo from your gallery to experience the product in your space."}
      </p>

      {/* Upload tap area */}
      {!hasPreview ? (
        <AnimatedButton
          type="button"
          onClick={openPicker}
          disabled={isSavingRoom}
          aria-label={isAr ? "اختيار صورة من معرض الهاتف" : "Choose image from gallery"}
          className="mt-6 flex w-full flex-col items-center justify-center gap-4 rounded-[24px] border-2 border-dashed border-[var(--brand-cyan)]/20 bg-[var(--brand-cyan)]/[0.04] py-12 transition-all duration-300 hover:border-[var(--brand-cyan)]/40 hover:bg-[var(--brand-cyan)]/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSavingRoom ? (
            <>
              <LoaderCircle className="size-8 animate-spin text-[var(--brand-cyan)]" />
              <span className="text-sm font-semibold text-[var(--brand-cyan)]">
                {roomSaveStatusLabel ?? t.common.actions.loading}
              </span>
            </>
          ) : (
            <>
              <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-gradient-to-br from-[#003C71] to-[#00AFD7]/60 shadow-[0_8px_24px_rgba(0,175,215,0.25)]">
                <ImagePlus className="size-7 text-white" strokeWidth={1.75} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-base font-semibold text-[var(--text-primary)]">
                  {isAr ? "اختيار صورة من المعرض" : "Select image from gallery"}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {isAr ? "اضغط هنا للاختيار" : "Tap here to select"}
                </span>
              </div>
            </>
          )}
        </AnimatedButton>
      ) : null}

      {/* Preview */}
      {hasPreview ? (
        <div className="mt-6">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[20px] border border-[var(--border)] shadow-[0_8px_32px_rgba(0,0,0,0.20)]">
            <Image
              src={selectedRoom!.imageUrl!}
              alt={isAr ? "صورة الغرفة المختارة" : "Selected room image"}
              fill
              unoptimized
              className="object-cover"
            />
            {isSavingRoom ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[20px] bg-[var(--bg-page)]/80 backdrop-blur-sm">
                <LoaderCircle className="size-7 animate-spin text-[var(--brand-cyan)]" />
                <span className="text-sm font-semibold text-[var(--text-secondary)]">
                  {roomSaveStatusLabel ?? t.common.actions.loading}
                </span>
              </div>
            ) : null}
          </div>

          {!isSavingRoom ? (
            <AnimatedButton
              type="button"
              onClick={openPicker}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface-2)] py-3 text-sm font-semibold text-[var(--text-secondary)] transition-all duration-200 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
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
