"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";

// Installed from https://21st.dev/r/minhxthanh/image-comparison-slider and
// typed for this codebase. The drag interaction (initial 50% position,
// horizontal mouse + touch drag, clip-path reveal, vertical divider, circular
// handle with scale-while-dragging, 0–100 clamping, stop-on-release/leave and
// global mouse-up cleanup) is preserved exactly from the original source.

export interface ImageComparisonProps {
  /** Original uploaded room image (revealed on the right of the divider). */
  beforeImage: string;
  /** Generated / rendered result image (revealed on the left of the divider). */
  afterImage: string;
  altBefore?: string;
  altAfter?: string;
  className?: string;
  /** Fit mode for BOTH layers — keep identical so the images align exactly. */
  imageFit?: "cover" | "contain";
  /** Optional visible badge labels (preserves the existing result UI labels). */
  beforeLabel?: string;
  afterLabel?: string;
}

// This component takes two image URLs (before and after) and creates a slider to compare them.
export const ImageComparison: React.FC<ImageComparisonProps> = ({
  beforeImage,
  afterImage,
  altBefore = "قبل التصميم",
  altAfter = "بعد التصميم",
  className = "",
  imageFit = "contain",
  beforeLabel,
  afterLabel,
}) => {
  // State to track the slider's position (from 0 to 100)
  const [sliderPosition, setSliderPosition] = useState(50);
  // State to track if the user is currently dragging the slider
  const [isDragging, setIsDragging] = useState(false);

  // Ref to the main container element to get its dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  // Both layers must share the exact same object-fit and object-position so the
  // before/after images align perfectly with no crop or zoom difference.
  const imageClass = `block h-full w-full ${
    imageFit === "cover" ? "object-cover" : "object-contain"
  } object-center`;

  // Function to handle the slider movement (for both mouse and touch)
  const handleMove = useCallback(
    (clientX: number) => {
      // If not dragging or no container ref, do nothing
      if (!isDragging || !containerRef.current) return;

      // Get the bounding box of the container
      const rect = containerRef.current.getBoundingClientRect();
      // Calculate the new slider position as a percentage
      let newPosition = ((clientX - rect.left) / rect.width) * 100;

      // Clamp the position to be between 0 and 100 to prevent it from going out of bounds
      newPosition = Math.max(0, Math.min(100, newPosition));

      setSliderPosition(newPosition);
    },
    [isDragging],
  );

  // Mouse event handlers
  const handleMouseDown = useCallback(() => setIsDragging(true), []);
  const handleMouseUp = useCallback(() => setIsDragging(false), []);
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => handleMove(e.clientX),
    [handleMove],
  );

  // Touch event handlers
  const handleTouchStart = useCallback(() => setIsDragging(true), []);
  const handleTouchEnd = useCallback(() => setIsDragging(false), []);
  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => handleMove(e.touches[0].clientX),
    [handleMove],
  );

  // Effect to add and clean up the global mouse-up listener so dragging stops
  // even if the cursor is released outside the component area.
  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    // Clean up the event listener when the component unmounts
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full select-none overflow-hidden ${className}`}
      // pan-y lets the page scroll vertically but stops the browser from
      // hijacking the horizontal drag (no global scroll lock).
      style={{ touchAction: "pan-y" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseUp} // Stop dragging if mouse leaves the container
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* After Image (Top Layer) - Its visibility is controlled by the clip-path */}
      <div
        className="absolute top-0 left-0 h-full w-full overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <img src={afterImage} alt={altAfter} className={imageClass} draggable={false} />
      </div>

      {/* Before Image (Bottom Layer) */}
      <img src={beforeImage} alt={altBefore} className={imageClass} draggable={false} />

      {/* Optional visible labels — only rendered when provided, preserving the
          existing Arabic wording and position (after on the left, before on the right). */}
      {(beforeLabel || afterLabel) && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-between text-[11px] font-bold">
          {afterLabel ? (
            <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
              {afterLabel}
            </span>
          ) : (
            <span />
          )}
          {beforeLabel ? (
            <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
              {beforeLabel}
            </span>
          ) : (
            <span />
          )}
        </div>
      )}

      {/* Slider Handle */}
      <div
        className="absolute top-0 bottom-0 z-30 flex w-1.5 cursor-ew-resize items-center justify-center bg-white/80"
        style={{ left: `calc(${sliderPosition}% - 0.375rem)` }} // Center the handle on the line
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-md transition-all duration-200 ease-in-out ${
            isDragging ? "scale-110 shadow-xl" : ""
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-700"
          >
            <line x1="15" y1="18" x2="9" y2="12"></line>
            <line x1="9" y1="6" x2="15" y2="12"></line>
          </svg>
        </div>
      </div>
    </div>
  );
};

export default ImageComparison;
