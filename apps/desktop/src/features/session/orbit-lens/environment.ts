import { useSyncExternalStore } from "react";

// What the canvas can't read from CSS: the theme on <html> (themeStorage owns it), the
// reduced-motion preference and the device pixel ratio. All stay live while the lens is open.

function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

export function useDarkTheme(): boolean {
  return useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "dark",
  );
}

const reducedQuery = () =>
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

function subscribeReduced(cb: () => void) {
  const mq = reducedQuery();
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => reducedQuery()?.matches ?? false);
}

const dprNow = () => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/** Follows the pixel ratio across zoom and moves between displays. */
function subscribeDpr(cb: () => void) {
  if (typeof matchMedia !== "function") return () => {};
  // A query matches only the current ratio, so re-arm it after every change.
  let mq: MediaQueryList | null = null;
  const arm = () => {
    mq?.removeEventListener("change", onChange);
    mq = matchMedia(`(resolution: ${dprNow()}dppx)`);
    mq.addEventListener("change", onChange);
  };
  const onChange = () => {
    arm();
    cb();
  };
  arm();
  return () => mq?.removeEventListener("change", onChange);
}

export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribeDpr, dprNow);
}

/** Keyboard focus, not a mouse click: only then does the orb get the focus ring. */
export function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    // Engines without :focus-visible: treat focus as keyboard focus.
    return true;
  }
}
