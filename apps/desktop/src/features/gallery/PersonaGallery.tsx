import { agentColor, allocateMotion, motionCap } from "@gravita/orbs";
import { type ReactNode, useMemo, useState } from "react";
import { useToggleTheme } from "@/app/providers";
import { Orb } from "@/features/agents/Orb";
import { t, useLocale } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";
import { CanvasOrb } from "./CanvasOrb";
import { galleryPersonas } from "./personas";

// Dev-only review surface (#/gallery): every persona side by side in SVG and on canvas,
// with the theme, reduced motion and the 1/3 motion budget at hand. Never in production.

const TYPES = ["main", "Explore", "Plan", "general-purpose", "code-reviewer"];

/** "Reduced motion" for this subtree only, whatever the OS says. */
const REDUCED = `.persona-gallery[data-reduced-motion] :is(.orb-breathe, .orb-bob, .orb-bounce,
.orb-wobble, .orb-blink, .orb-wander, .orb-pop, .ring-pulse) { animation: none !important; }`;

const BUDGET_SIZE = 9;

export function PersonaGallery() {
  useLocale();
  const toggleTheme = useToggleTheme();
  const personas = useMemo(galleryPersonas, []);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const [reduced, setReduced] = useState(false);

  const waiting = personas.find((p) => p.persona.mood === "waiting")?.persona;
  const budget = useMemo(
    () =>
      allocateMotion(
        Array.from({ length: BUDGET_SIZE }, (_, i) => ({ id: `w${i}`, mood: "waiting" as const })),
        0,
      ),
    [],
  );

  return (
    <div
      className="persona-gallery mx-auto max-w-6xl px-8 py-8"
      data-reduced-motion={reduced || undefined}
    >
      <style>{REDUCED}</style>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("gallery.title")}</h1>
          <p className="mt-1 text-ink-2">{t("gallery.intro")}</p>
        </div>
        <div className="flex gap-2">
          <Toggle
            pressed={dark}
            onClick={() => {
              toggleTheme();
              setDark(document.documentElement.dataset.theme === "dark");
            }}
          >
            {t("gallery.dark")}
          </Toggle>
          <Toggle pressed={reduced} onClick={() => setReduced((r) => !r)}>
            {t("gallery.reducedMotion")}
          </Toggle>
        </div>
      </header>

      <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3">
        {personas.map(({ id, persona }, i) => {
          const type = TYPES[i % TYPES.length]!;
          const color = agentColor(type);
          return (
            <li key={id} data-persona={id} className="rounded-xl border border-hairline p-4">
              <div className="flex items-end gap-5">
                <Specimen caption={t("gallery.svg")}>
                  <div className="flex size-[72px] items-center justify-center">
                    <Orb color={color} persona={persona} size={48} seed={id} />
                  </div>
                </Specimen>
                <Specimen caption={t("gallery.canvas")}>
                  <CanvasOrb
                    color={color}
                    persona={persona}
                    size={48}
                    seed={id}
                    dark={dark}
                    reducedMotion={reduced}
                  />
                </Specimen>
              </div>
              <p className="mt-3 text-sm font-medium">
                {t(persona.label.key, persona.label.params)}
              </p>
              <p className="mt-0.5 font-mono text-2xs text-ink-3">{id}</p>
            </li>
          );
        })}
      </ul>

      {waiting && (
        <section aria-labelledby="gallery-budget" className="mt-8">
          <h2 id="gallery-budget" className="text-md font-bold">
            {t("gallery.budget")}
          </h2>
          <p className="mt-1 text-ink-2">
            {t("gallery.budgetNote")}{" "}
            <span className="font-mono text-2xs text-ink-3">
              cap = max(1, ⌊{BUDGET_SIZE}/3⌋) = {motionCap(BUDGET_SIZE)}
            </span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4" data-testid="gallery-budget-row">
            {Array.from({ length: BUDGET_SIZE }, (_, i) => (
              <Orb
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of nine.
                key={i}
                color={agentColor(TYPES[i % TYPES.length]!)}
                persona={waiting}
                size={32}
                seed={`w${i}`}
                motion={budget.has(`w${i}`) ? "primary" : "ambient"}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex flex-col items-center gap-1">
      {children}
      <figcaption className="text-2xs text-ink-3">{caption}</figcaption>
    </figure>
  );
}

function Toggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-sm font-medium",
        pressed ? "border-ink bg-ink text-ground" : "border-hairline-strong text-ink-2",
      )}
    >
      {children}
    </button>
  );
}
