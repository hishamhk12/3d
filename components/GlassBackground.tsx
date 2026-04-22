"use client";

interface GlassBackgroundProps {
  videoSrc?: string;
}

export default function GlassBackground({ videoSrc }: GlassBackgroundProps) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 bg-black"
      aria-hidden="true"
    >
      {/* Background layer */}
      {videoSrc ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-80"
          src={videoSrc}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:    "url('/صور الموقع/michael-guo-1YS9heKaRsg-unsplash.jpg')",
            backgroundSize:     "cover",
            backgroundPosition: "65% center",
            backgroundRepeat:   "no-repeat",
          }}
        />
      )}

      {/* Layer 2: Soft gradient-based blur (strongest in center) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          maskImage: "radial-gradient(ellipse at 50% 50%, black 15%, transparent 65%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 50%, black 15%, transparent 65%)",
        }}
      />

      {/* Layer 3: Dark Overlay + Enhanced lighting veil for depth & text readability */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 10%, rgba(0, 175, 215, 0.12) 0%, transparent 50%), linear-gradient(170deg, rgba(5,8,15,0.4) 0%, rgba(5,8,15,0.2) 40%, rgba(0,5,15,0.6) 100%)",
        }}
      />
    </div>
  );
}
