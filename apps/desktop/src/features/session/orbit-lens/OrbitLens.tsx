import type { SessionState } from "@gravita/core";
import {
  DARK_THEME,
  LIGHT_THEME,
  MIN_FRAME,
  type OrbitBody,
  type OrbitFrame,
  type OrbitInput,
  OrbitScene,
} from "@gravita/orbs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t, useLocale } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";
import { focusVisible, useDarkTheme, useDevicePixelRatio, useReducedMotion } from "./environment";
import { orbitInput } from "./orbitInput";

/** Small moons still get a comfortable pointer target. */
const MIN_TARGET = 24;

interface OrbitLensProps {
  session: SessionState;
  project: { id: string; name: string };
  now: number;
  selectedAgentId?: string;
  onSelect: (agentId: string) => void;
}

/**
 * The session as a small solar system: the project is the sun, agents are planets and
 * subagents their moons. A canvas paints it (one rAF loop in OrbitScene, outside React);
 * a layer of transparent buttons on top makes every orb focusable, named and clickable.
 */
export default function OrbitLens({
  session,
  project,
  now,
  selectedAgentId,
  onSelect,
}: OrbitLensProps) {
  useLocale();
  const orbit = useMemo(() => orbitInput(session, project, now), [session, project, now]);
  return (
    <OrbitPane
      orbit={orbit}
      projectName={project.name}
      {...(selectedAgentId ? { selectedAgentId } : {})}
      onSelect={onSelect}
    />
  );
}

export interface OrbitPaneProps {
  /** The scene's input with each body's display name and accessible label. */
  orbit: { input: OrbitInput; labels: Map<string, string>; names: Map<string, string> };
  projectName: string;
  selectedAgentId?: string;
  onSelect: (agentId: string) => void;
}

/**
 * The canvas and its accessible buttons, for any orbit input: one session (the lens
 * above) or a squad, whose roles are the planets.
 */
export function OrbitPane({ orbit, projectName, selectedAgentId, onSelect }: OrbitPaneProps) {
  useLocale();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<OrbitScene | null>(null);
  const [frame, setFrame] = useState<OrbitFrame>(MIN_FRAME);
  const [bodies, setBodies] = useState<readonly OrbitBody[]>([]);
  const [painted, setPainted] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const dark = useDarkTheme();
  const reduced = useReducedMotion();
  const dpr = useDevicePixelRatio();
  const { input, labels, names } = orbit;

  // Declared first so it runs first: the effects below talk to the scene it creates.
  useLayoutEffect(() => {
    // jsdom has no canvas: the scene then only lays out, and the buttons still work.
    const ctx = canvas.current?.getContext("2d") ?? null;
    const s = new OrbitScene({ ctx });
    scene.current = s;
    setPainted(ctx !== null);
    const off = s.onPositions(setBodies);
    return () => {
      off();
      s.destroy();
      scene.current = null;
    };
  }, []);

  // Fill the pane; below the minimum frame, scroll rather than squeeze.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () =>
      setFrame((f) => {
        const width = Math.max(el.clientWidth, MIN_FRAME.width);
        const height = Math.max(el.clientHeight, MIN_FRAME.height);
        return f.width === width && f.height === height ? f : { width, height };
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (el) {
      el.width = Math.round(frame.width * dpr);
      el.height = Math.round(frame.height * dpr);
    }
    scene.current?.resize(frame.width, frame.height, dpr);
  }, [frame, dpr]);

  // The sun's initial may first paint in a fallback face; with reduced motion there's no
  // next frame to fix it, so repaint once DM Sans is in.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && scene.current?.redraw());
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => scene.current?.setTheme(dark ? DARK_THEME : LIGHT_THEME), [dark]);
  useEffect(() => scene.current?.setReducedMotion(reduced), [reduced]);
  useEffect(() => scene.current?.setInput(input), [input]);
  useEffect(() => scene.current?.setSelected(selectedAgentId ?? null), [selectedAgentId]);
  useEffect(() => scene.current?.setFocus(focused), [focused]);

  return (
    <div ref={host} className="relative h-full overflow-auto">
      <div className="relative" style={{ width: frame.width, height: frame.height }}>
        {/* The picture only; the buttons below carry names and actions. */}
        <div aria-hidden="true" className="absolute inset-0">
          <canvas
            ref={canvas}
            className="block"
            style={{ width: frame.width, height: frame.height }}
          />
        </div>
        <div
          role="group"
          aria-label={t("orbit.label", { project: projectName })}
          className="absolute inset-0"
        >
          {bodies.map((b) => {
            // The sun is the project itself: decorative here, the breadcrumb names it.
            if (b.kind === "sun") return null;
            const swarm = b.kind === "swarm";
            // A swarm stands for its parent's crowd: it opens the parent, which lists them.
            const target = swarm ? b.parentId : b.id;
            if (!target) return null;
            const label = swarm
              ? t("orbit.swarm", { count: b.count ?? 0, parent: names.get(target) ?? target })
              : (labels.get(b.id) ?? b.id);
            const size = Math.max(b.r * 2, MIN_TARGET);
            return (
              <button
                key={b.id}
                type="button"
                aria-label={label}
                title={label}
                aria-current={!swarm && selectedAgentId === b.id ? "true" : undefined}
                onClick={() => onSelect(target)}
                onFocus={(e) => setFocused(focusVisible(e.currentTarget) ? b.id : null)}
                onBlur={() => setFocused((f) => (f === b.id ? null : f))}
                onPointerEnter={() => scene.current?.setHover(b.id)}
                onPointerLeave={() => scene.current?.setHover(null)}
                className={cn(
                  "absolute cursor-pointer rounded-full",
                  // The scene draws the focus ring around the orb; CSS is the fallback.
                  painted && "focus-visible:outline-none",
                )}
                style={{ left: b.x - size / 2, top: b.y - size / 2, width: size, height: size }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
