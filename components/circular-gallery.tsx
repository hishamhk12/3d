"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, HTMLAttributes } from 'react';

// A simple utility for conditional class names
const cn = (...classes: (string | undefined | null | false)[]) => {
  return classes.filter(Boolean).join(' ');
}

// Image-only gallery item (demo animal fields removed).
export interface CircularGalleryItem {
  /** Image URL (real local project asset). */
  url: string;
  /** Accessible label (not rendered as a visible caption). */
  alt?: string;
  /** Optional object-position for the cover image. */
  pos?: string;
}

// Define the props for the CircularGallery component
interface CircularGalleryProps extends HTMLAttributes<HTMLDivElement> {
  items: CircularGalleryItem[];
  /** Controls how far the items are from the center. */
  radius?: number;
  /** Controls the speed of auto-rotation when not scrolling. */
  autoRotateSpeed?: number;
  /** Card dimensions (px). Square room images → square cards by default. */
  cardWidth?: number;
  cardHeight?: number;
  /** 3D perspective distance (px). */
  perspective?: number;
}

/** Tracks the user's reduced-motion preference. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const CircularGallery = React.forwardRef<HTMLDivElement, CircularGalleryProps>(
  (
    {
      items,
      className,
      radius = 600,
      autoRotateSpeed = 0.02,
      cardWidth = 300,
      cardHeight = 400,
      perspective = 2000,
      ...props
    },
    ref
  ) => {
    const [isScrolling, setIsScrolling] = useState(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const galleryRingRef = useRef<HTMLDivElement>(null);
    const rotationRef = useRef(0);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
    const prefersReducedMotion = usePrefersReducedMotion();

    const anglePerItem = items.length > 0 ? 360 / items.length : 0;

    // Fades cards toward the back of the ring based on their angle from the front.
    const getItemOpacity = (itemAngle: number, rotation: number) => {
      const totalRotation = rotation % 360;
      const relativeAngle = (itemAngle + totalRotation + 360) % 360;
      const normalizedAngle = Math.abs(relativeAngle > 180 ? 360 - relativeAngle : relativeAngle);
      return Math.max(0.3, 1 - (normalizedAngle / 180));
    };

    // Rotation lives in a ref and is written straight to the DOM so the
    // per-frame animation doesn't re-render React.
    const applyRotation = (rotation: number) => {
      rotationRef.current = rotation;
      if (galleryRingRef.current) {
        galleryRingRef.current.style.transform = `rotateY(${rotation}deg)`;
      }
      itemRefs.current.forEach((el, i) => {
        if (el) el.style.opacity = String(getItemOpacity(i * anglePerItem, rotation));
      });
    };

    // Re-sync the DOM with the live rotation after every commit (e.g. when
    // items change), since render only knows the initial rotation of 0.
    useLayoutEffect(() => {
      applyRotation(rotationRef.current);
    });

    // Effect to handle scroll-based rotation (original logic, unchanged).
    useEffect(() => {
      const handleScroll = () => {
        setIsScrolling(true);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }

        const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollProgress = scrollableHeight > 0 ? window.scrollY / scrollableHeight : 0;
        const scrollRotation = scrollProgress * 360;
        applyRotation(scrollRotation);

        scrollTimeoutRef.current = setTimeout(() => {
          setIsScrolling(false);
        }, 150);
      };

      window.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        window.removeEventListener('scroll', handleScroll);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    }, []);

    // Effect for auto-rotation when not scrolling (original equation preserved:
    // `prev + autoRotateSpeed`). Disabled under reduced-motion → the ring holds a
    // stable front-facing arrangement (rotation 0) while staying fully visible.
    useEffect(() => {
      const autoRotate = () => {
        if (!isScrolling && !prefersReducedMotion) {
          applyRotation(rotationRef.current + autoRotateSpeed);
        }
        animationFrameRef.current = requestAnimationFrame(autoRotate);
      };

      animationFrameRef.current = requestAnimationFrame(autoRotate);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [isScrolling, autoRotateSpeed, prefersReducedMotion]);

    return (
      <div
        ref={ref}
        role="region"
        aria-label="Circular 3D Gallery"
        className={cn("relative w-full h-full flex items-center justify-center", className)}
        style={{ perspective: `${perspective}px` }}
        {...props}
      >
        <div
          ref={galleryRingRef}
          className="relative w-full h-full"
          style={{
            transform: `rotateY(0deg)`,
            transformStyle: 'preserve-3d',
          }}
        >
          {items.map((item, i) => {
            const itemAngle = i * anglePerItem;
            const opacity = getItemOpacity(itemAngle, 0);

            return (
              <div
                key={item.url}
                ref={(el) => { itemRefs.current[i] = el; }}
                role="group"
                aria-label={item.alt}
                className="absolute"
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  transform: `rotateY(${itemAngle}deg) translateZ(${radius}px)`,
                  left: '50%',
                  top: '50%',
                  marginLeft: -cardWidth / 2,
                  marginTop: -cardHeight / 2,
                  opacity: opacity,
                  transition: 'opacity 0.3s linear'
                }}
              >
                {/* Image-only rounded card (demo footer / animal-card borders removed). */}
                <div className="relative w-full h-full overflow-hidden rounded-[28px] shadow-2xl">
                  <img
                    src={item.url}
                    alt={item.alt ?? ''}
                    loading={i === 0 || i === 1 || i === items.length - 1 ? 'eager' : 'lazy'}
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ objectPosition: item.pos || 'center' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

CircularGallery.displayName = 'CircularGallery';

export { CircularGallery };
