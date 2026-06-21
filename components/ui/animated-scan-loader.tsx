import Image from "next/image";

/**
 * Animated Scan Loader — the original 21st.dev component.
 *
 * Structure and animation behaviour are kept exactly as the source: a
 * `relative` container holding one `animate-cut` wrapper and two `animate-scan`
 * glowing scan lines (a blurred halo layer + a sharp core layer). The only
 * adaptations requested:
 *   • the visible `Barcode` text is replaced by the company SVG logo, rendered
 *     inside the `animate-cut` wrapper with its aspect ratio preserved;
 *   • the two red scan-line colours (#FF8282) become the company cyan (#00ADD7);
 *   • the hard-coded 54px scan travel is computed from the logo container height
 *     instead — see `@keyframes scan` in app/globals.css (calc(100% - 5px)).
 */

// public/شعار/شعار الشركة.svg — encodeURI keeps the Arabic folder/file + space URL-safe.
export const COMPANY_LOGO_SRC = encodeURI("/شعار/شعار الشركة.svg");
// width/height carry only the intrinsic aspect ratio (viewBox 260.49 × 86.59,
// scaled ×100) so the rendered logo never distorts; display size is set below.
export const LOGO_RATIO_W = 26049;
export const LOGO_RATIO_H = 8659;

export default function AnimatedScanLoader() {
  return (
    <div className="relative max-w-fit">
      {/* Original animate-cut wrapper — now wrapping the company logo instead of
          the "Barcode" text. The logo stays large, centered and undistorted. */}
      <span className="block animate-cut transition-all duration-1000 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]">
        <Image
          src={COMPANY_LOGO_SRC}
          alt="شعار الشركة"
          width={LOGO_RATIO_W}
          height={LOGO_RATIO_H}
          priority
          unoptimized
          draggable={false}
          className="block h-auto w-[min(640px,58vw)] select-none"
        />
      </span>

      {/* Glowing scan line — blurred halo layer (cyan instead of red). */}
      <div className="absolute left-0 top-0 z-0 h-[6px] w-full rounded bg-[#00ADD791] blur-[10px] animate-scan transition-all duration-1000 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"></div>

      {/* Glowing scan line — sharp core layer (cyan instead of red). */}
      <div className="absolute left-0 top-0 z-[1] h-[5px] w-full rounded bg-[#00ADD7] opacity-90 animate-scan transition-all duration-1000 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"></div>
    </div>
  );
}
