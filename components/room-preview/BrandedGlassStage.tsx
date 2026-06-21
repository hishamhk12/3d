import type { ReactNode } from "react";

type BrandedGlassStageProps = {
  /** Full CSS background-image value, e.g. `url("/croissant.jpg")`. */
  backgroundImage: string;
  children: ReactNode;
};

/**
 * Shared full-screen background + large central visionOS glass panel.
 *
 * Extracted verbatim from BrandedQrLoadingScreen (the /room-preview → QR
 * transition/logo loader) so the QR session screen and the logo loading page
 * render the *exact* same background treatment and glass surface from a single
 * source of truth. The only per-page variable is the background image.
 *
 * Renders absolutely-positioned layers — the caller must provide a positioned,
 * full-viewport ancestor (the `screen-kiosk-page` <main>). No interactivity /
 * hooks, so it works as either a server or client component.
 */
export default function BrandedGlassStage({ backgroundImage, children }: BrandedGlassStageProps) {
  return (
    <>
      {/* Full-screen background — same rendering rules as the logo loader */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage,
          backgroundSize: "cover",
          backgroundPosition: "center",
          zIndex: 0,
        }}
      />
      {/* Minimal readability overlay (keeps the glass panel legible over the bright image) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(6,12,22,0.28) 0%, rgba(6,12,22,0.14) 40%, rgba(6,12,22,0.30) 100%)",
          zIndex: 1,
        }}
      />

      {/* Large central visionOS glass panel (Figma node 509:5215 window) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <div
          className="qr-glass-panel"
          style={{
            position: "relative",
            width: "95vw",
            height: "92vh",
            maxWidth: "none",
            flexShrink: 0,
            borderRadius: 48,
            border: "1px solid rgba(255,255,255,0.22)",
            background:
              "linear-gradient(165deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0.05) 100%)",
            backdropFilter: "blur(50px) saturate(135%)",
            WebkitBackdropFilter: "blur(50px) saturate(135%)",
            boxShadow:
              "0 60px 140px rgba(0,0,0,0.50), 0 10px 34px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.40), inset 0 0 0 1px rgba(255,255,255,0.05)",
            overflow: "hidden",
          }}
        >
          {/* Inner top highlight (glass sheen) */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 48,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.05) 14%, rgba(255,255,255,0) 32%)",
              pointerEvents: "none",
            }}
          />

          {children}
        </div>
      </div>
    </>
  );
}
