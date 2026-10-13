import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssBezier, EASE, ORB_MOTION } from "@gravita/orbs";
import { describe, expect, test } from "vitest";

// The SVG orb animates with CSS; the canvas scene with the rig. Both read the same timings.
const css = readFileSync(join(__dirname, "../../styles.css"), "utf8").replace(/\s+/g, " ");
const s = (ms: number) => `${ms / 1000}s`;

describe("CSS orb motion matches @gravita/orbs tokens", () => {
  test("eases", () => {
    expect(css).toContain(`--ease-signature: ${cssBezier(EASE.signature).replace(/,/g, ", ")}`);
    expect(css).toContain(`--ease-pop: ${cssBezier(EASE.pop).replace(/,/g, ", ")}`);
  });

  test("loop periods", () => {
    expect(css).toContain(`animation: orb-bob ${s(ORB_MOTION.bob.period)}`);
    expect(css).toContain(`animation: orb-bounce ${s(ORB_MOTION.bounce.period)}`);
    expect(css).toContain(`animation: orb-wobble ${s(ORB_MOTION.wobble.period)}`);
    expect(css).toContain(`orb-blink var(--orb-blink, ${s(ORB_MOTION.blink.period)})`);
    expect(css).toContain(`animation: orb-wander ${s(ORB_MOTION.wander.period)}`);
    expect(css).toContain(`animation: orb-pop ${ORB_MOTION.pop.duration}ms`);
    expect(css).toContain(`animation: ring-pulse ${s(ORB_MOTION.halo.period)}`);
  });

  test("keyframe extents", () => {
    expect(css).toContain(`transform: scale(${ORB_MOTION.breathe.scale})`);
    expect(css).toContain(`transform: translateY(-${ORB_MOTION.bob.lift}px)`);
    expect(css).toContain(`translateY(-${ORB_MOTION.bounce.lift}px)`);
    expect(css).toContain(`rotate(-${ORB_MOTION.wobble.deg}deg)`);
    expect(css).toContain(`transform: scale(${ORB_MOTION.pop.from})`);
  });
});
