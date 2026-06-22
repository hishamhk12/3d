import { useEffect } from "react";

/**
 * Blurs the active text field, if any, to dismiss the mobile soft keyboard.
 * A no-op unless an <input>, <textarea>, or <select> currently holds focus — it
 * never blurs other elements and never touches the wider document. Safe on the
 * server (guards `document`).
 */
export function dismissMobileKeyboard(): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    active.blur();
  }
}

/**
 * Mobile-safe "clean entry" guard for a page reached by a Next.js SOFT
 * navigation (e.g. a customer-gate or login form submit). Focus — and with it
 * the iPhone/Android keyboard and its compressed visual viewport — can survive
 * the route change and leave the new page scrolled, clipped, or pushed offscreen.
 *
 * On mount this blurs whatever field is still focused, then repeats on the next
 * two animation frames to also catch Safari's post-navigation focus restoration
 * and to let the visual viewport settle back to full height before paint. It
 * never focuses anything, so the keyboard only reopens when the user taps an
 * input. Listeners are cleaned up on unmount.
 */
export function useDismissKeyboardOnEnter(): void {
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    dismissMobileKeyboard();
    raf1 = requestAnimationFrame(() => {
      dismissMobileKeyboard();
      raf2 = requestAnimationFrame(dismissMobileKeyboard);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
}
