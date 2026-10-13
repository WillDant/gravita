import type { Persona } from "@gravita/core";
import { type AgentColor, DARK_THEME, LIGHT_THEME, paintOrb } from "@gravita/orbs";
import { useEffect, useRef } from "react";
import { subscribeFrame } from "./sharedFrame";

interface CanvasOrbProps {
  color: AgentColor;
  persona: Persona;
  size: number;
  seed: string;
  dark: boolean;
  reducedMotion: boolean;
  motion?: "primary" | "ambient";
}

/** The same persona painted the way the Orbit lens paints it, for side-by-side review. */
export function CanvasOrb({
  color,
  persona,
  size,
  seed,
  dark,
  reducedMotion,
  motion = "primary",
}: CanvasOrbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Room around the body for the waiting halo and the glyph badge.
  const box = Math.ceil(size * 1.5);

  useEffect(() => {
    const canvas = ref.current;
    // jsdom (and a lost GPU context) has no 2D context: leave the canvas blank.
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = box * dpr;
    canvas.height = box * dpr;
    const theme = dark ? DARK_THEME : LIGHT_THEME;
    return subscribeFrame((t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box, box);
      paintOrb(
        ctx,
        { x: box / 2, y: box / 2, size, color, persona, t, seed, motion, reducedMotion },
        theme,
      );
    });
  }, [box, color, persona, size, seed, dark, reducedMotion, motion]);

  // No fallback content: screen readers skip it; the SVG twin carries the persona.
  return <canvas ref={ref} style={{ width: box, height: box }} />;
}
