import { useEffect, useId, useRef, useState } from "react";
import { useProjectAppearance } from "@/app/providers";
import {
  PROJECT_ICON_IDS,
  PROJECT_TONE_IDS,
} from "@/infrastructure/preferences/projectAppearance";
import { t } from "@/shared/i18n/i18n";
import { PROJECT_ICONS } from "@/shared/ui/projectIcons";
import { ProjectTile } from "@/shared/ui/ProjectTile";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";

/**
 * The project's tile in its header, large: pressing it opens a small panel to pick the icon
 * and the colour. A choice applies at once, so the menu on the left follows as it is made.
 */
export function ProjectAppearancePicker({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const { appearance, set, reset } = useProjectAppearance(projectId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const icon = appearance?.icon ?? "";
  const tone = appearance?.tone ?? "neutral";

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={t("project.appearance.open")}
        title={t("project.appearance.open")}
        onClick={() => setOpen((v) => !v)}
        className="rounded-xl transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
      >
        <ProjectTile name={name} appearance={appearance} size="lg" />
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label={t("project.appearance.title")}
          className="absolute top-full left-0 z-20 mt-2 flex w-[19rem] flex-col gap-4 rounded-xl border border-hairline bg-panel p-4 shadow-float"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-semibold text-ink-2">
              {t("project.appearance.icon")}
            </legend>
            <div className="grid grid-cols-7 gap-1">
              <Choice
                name={`${id}-icon`}
                value=""
                checked={icon === ""}
                label={t("project.appearance.initial")}
                onChange={() => set({ icon: undefined })}
              >
                <span className="text-sm font-bold uppercase">
                  {name.replace(/[^a-z0-9]/gi, "").slice(0, 1) || "·"}
                </span>
              </Choice>
              {PROJECT_ICON_IDS.map((i) => {
                const Icon = PROJECT_ICONS[i];
                return (
                  <Choice
                    key={i}
                    name={`${id}-icon`}
                    value={i}
                    checked={icon === i}
                    label={t(`project.appearance.icon.${i}`)}
                    onChange={() => set({ icon: i })}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </Choice>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-semibold text-ink-2">
              {t("project.appearance.color")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {PROJECT_TONE_IDS.map((tn) => (
                <Choice
                  key={tn}
                  name={`${id}-tone`}
                  value={tn}
                  checked={tone === tn}
                  label={t(`project.appearance.tone.${tn}`)}
                  onChange={() => set({ tone: tn === "neutral" ? undefined : tn })}
                  round
                >
                  <span
                    aria-hidden="true"
                    data-tone={tn === "neutral" ? undefined : tn}
                    className={cn(
                      "size-5 rounded-full",
                      tn === "neutral" ? "bg-ink-3/40" : "bg-(--tile-fg)",
                    )}
                  />
                </Choice>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              {t("project.appearance.reset")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One radio of a group, drawn as a small tile; arrow keys move between them. */
function Choice({
  name,
  value,
  checked,
  label,
  onChange,
  round,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  onChange: () => void;
  round?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      title={label}
      className={cn(
        "flex size-8 cursor-pointer items-center justify-center text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink has-focus-visible:outline-2 has-focus-visible:outline-focus motion-reduce:transition-none",
        round ? "rounded-full" : "rounded-lg",
        checked && "bg-ground text-ink ring-2 ring-focus",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="sr-only"
      />
      {children}
    </label>
  );
}
