import { DURATION, EASE } from "@gravita/orbs";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Motion for chrome, loaded only by the lazy screens that use it: the small DOM feature set,
 * the signature ease at the base step, and nothing moves when the OS asks for reduced motion.
 */
export function Motion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: DURATION.base / 1000, ease: [...EASE.signature] }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
