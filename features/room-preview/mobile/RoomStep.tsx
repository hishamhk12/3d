"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { MobileActionButton } from "@/components/room-preview/MobileActionButton";
import type { RoomPreviewRoomSource, SelectedRoom } from "@/lib/room-preview/types";
import type { SaveStatus } from "@/features/room-preview/mobile/mobile-session-utils";
import {
  RoomUploadStatus,
  type RoomUploadStatusState,
} from "@/features/room-preview/mobile/RoomUploadStatus";

interface RoomStepProps {
  isSavingRoom: boolean;
  roomSaveStatus: SaveStatus;
  roomSaveStatusLabel: string | null;
  uploadError: string | null;
  selectedRoom: SelectedRoom | null;
  onFileSelection: (source: Extract<RoomPreviewRoomSource, "gallery">, file: File | null) => void;
  onRetryUpload: () => Promise<boolean> | boolean;
}

export default function RoomStep({
  isSavingRoom,
  roomSaveStatus,
  roomSaveStatusLabel,
  uploadError,
  selectedRoom,
  onFileSelection,
  onRetryUpload,
}: RoomStepProps) {
  const { locale, t, dir } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPortraitPreview, setIsPortraitPreview] = useState(false);

  const openPicker = () => {
    if (!isSavingRoom) inputRef.current?.click();
  };

  const hasPreview = Boolean(selectedRoom?.imageUrl);
  const isAr = locale === "ar";
  const uploadCardState: RoomUploadStatusState =
    roomSaveStatus === "success"
      ? "success"
      : isSavingRoom
        ? "uploading"
        : roomSaveStatus === "error"
          ? "error"
          : "idle";
  const canOpenUploadPicker = uploadCardState === "idle";

  const handleRetryUpload = async () => {
    const didRetry = await onRetryUpload();
    if (!didRetry) {
      openPicker();
    }
  };

  const handleUploadCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canOpenUploadPicker || isSavingRoom) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  };

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!selectedRoom?.imageUrl) {
      timers.push(setTimeout(() => setIsPortraitPreview(false), 0));
      return () => timers.forEach(clearTimeout);
    }

    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (!active) return;
      setIsPortraitPreview(image.naturalHeight > image.naturalWidth);
    };
    image.onerror = () => {
      if (!active) return;
      setIsPortraitPreview(false);
    };
    image.src = selectedRoom.imageUrl;

    return () => {
      active = false;
      timers.forEach(clearTimeout);
    };
  }, [selectedRoom?.imageUrl]);

  return (
    <section
      className={
        hasPreview
          ? `mt-4 ${dir === "rtl" ? "text-right" : "text-left"}`
          : "flex min-h-[calc(100svh-2.25rem)] w-full flex-col items-center justify-center py-6 text-center"
      }
    >
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

      {!hasPreview ? (
        <div className="mx-auto flex w-full max-w-[345px] flex-col items-center">
          {/* Heading */}
          <h2 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
            {isAr ? "ارفع صورة غرفتك" : "Upload your room image"}
          </h2>
          <p className="mx-auto mt-3 max-w-xs text-center text-sm leading-7 text-[var(--text-secondary)]">
            {isAr
              ? "اختر صورة واضحة لتجربة المنتج داخل مساحتك."
              : "Choose a clear photo to preview the product in your space."}
          </p>

          {/* Upload drop-zone - Figma uploader card adapted to brand tokens */}
          <div
            role={canOpenUploadPicker ? "button" : undefined}
            tabIndex={canOpenUploadPicker ? 0 : undefined}
            onClick={canOpenUploadPicker ? openPicker : undefined}
            onKeyDown={handleUploadCardKeyDown}
            aria-disabled={isSavingRoom ? "true" : undefined}
            aria-label={isAr ? "اختيار صورة من معرض الهاتف" : "Choose image from gallery"}
            className="group mt-6 flex w-full flex-col items-center justify-center gap-4 rounded-[40px] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)] transition-all duration-300 hover:border-[var(--brand-cyan)]/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            <div className="flex min-h-[180px] w-full flex-col items-center justify-center gap-4 rounded-[32px] border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.05] px-6 py-10">
              <RoomUploadStatus
                state={uploadCardState}
                errorMessage={uploadCardState === "error" ? uploadError : null}
                onRetry={handleRetryUpload}
              />
            </div>
          </div>

          {/* Primary action — single action page → project primary brand colour */}
          {uploadCardState === "idle" ? (
            <MobileActionButton variant="primary" onClick={openPicker} className="mt-5">
              {isAr ? "اختيار صورة من المعرض" : "Select image from gallery"}
            </MobileActionButton>
          ) : null}

          {/* Photo guidance */}
          <p className="mt-4 text-center text-xs leading-6 text-[var(--text-muted)]">
            {isAr
              ? "صوّر الغرفة بشكل أفقي وبإضاءة واضحة."
              : "Capture the room horizontally with clear lighting."}
          </p>
        </div>
      ) : (
        /* Preview state */
        <>
          {/* Heading */}
          <h2 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
            {isAr ? "ارفع صورة غرفتك" : "Upload your room image"}
          </h2>
          <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-7 text-[var(--text-secondary)]">
            {isAr
              ? "اختر صورة واضحة لتجربة المنتج داخل مساحتك."
              : "Choose a clear photo to preview the product in your space."}
          </p>
          <div className="mt-6">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[28px] border border-[var(--border)] shadow-[0_8px_32px_rgba(0,0,0,0.20)]">
              <Image
                src={selectedRoom!.imageUrl!}
                alt=""
                fill
                unoptimized
                className="scale-110 object-cover opacity-45 blur-2xl"
                aria-hidden
              />
              <div className="absolute inset-0 bg-[var(--bg-page)]/35" aria-hidden />
              <Image
                src={selectedRoom!.imageUrl!}
                alt={isAr ? "صورة الغرفة المختارة" : "Selected room image"}
                fill
                unoptimized
                className="object-contain"
              />
              {isSavingRoom ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[28px] bg-[var(--bg-page)]/80 backdrop-blur-sm">
                  <LoaderCircle className="size-7 animate-spin text-[var(--brand-cyan)]" />
                  <span className="text-sm font-semibold text-[var(--text-secondary)]">
                    {roomSaveStatusLabel ?? t.common.actions.loading}
                  </span>
                </div>
              ) : null}
            </div>

            {isPortraitPreview ? (
              <p className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center text-xs leading-6 text-[var(--text-secondary)]">
                {isAr
                  ? "الصورة طولية، قد تظهر بفراغات جانبية. الأفضل تصوير الغرفة أفقياً."
                  : "This photo is portrait, so it may show side spacing. Landscape photos work best."}
              </p>
            ) : null}

            {!isSavingRoom ? (
              <MobileActionButton
                variant="primary"
                onClick={openPicker}
                className="mt-4"
                icon={<RefreshCw className="size-5" strokeWidth={2.25} />}
              >
                {isAr ? "تغيير الصورة" : "Change image"}
              </MobileActionButton>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
