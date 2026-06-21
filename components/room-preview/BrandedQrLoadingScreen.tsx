import AnimatedScanLoader from "@/components/ui/animated-scan-loader";
import BrandedGlassStage from "@/components/room-preview/BrandedGlassStage";

type BrandedQrLoadingScreenProps = {
  description: string;
  dir: "ltr" | "rtl";
  title: string;
};

/**
 * Transition screen between /room-preview and the QR screen.
 *
 * The same full-screen background used on /room-preview with a large central
 * visionOS-style glass panel (Figma node 509:5215, the Nike Vision Pro store
 * window). The company logo is pinned to the exact centre of the glass panel
 * and animated by the 21st.dev <AnimatedScanLoader /> (continuous glowing cyan
 * scan line + clip-path cut, looping). The background, glass panel and layout
 * are unchanged.
 *
 * `title` / `description` are still accepted (call site unchanged) but not
 * rendered here.
 */
export default function BrandedQrLoadingScreen({ dir }: BrandedQrLoadingScreenProps) {
  return (
    <main
      className="screen-kiosk-page dark relative overflow-hidden text-white"
      dir={dir}
    >
      {/* Full-screen background + glass panel — shared with the QR session screen */}
      <BrandedGlassStage backgroundImage='url("/room-preview/private.jpg")'>
        {/* Company logo pinned to the exact centre of the glass panel,
            animated by the 21st.dev scan loader (glowing cyan scan line). */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <AnimatedScanLoader />
        </div>
      </BrandedGlassStage>
    </main>
  );
}
