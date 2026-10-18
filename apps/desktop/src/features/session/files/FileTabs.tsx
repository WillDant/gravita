import { X } from "lucide-react";
import { t, useLocale } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";
import { fileIcon } from "./fileIcon";
import { isDirty, type OpenFile } from "./openFiles";
import { baseName } from "./useFileActions";

/**
 * The open files as editor tabs. A tab with unsaved edits shows a dot where its close
 * button is (the button comes back on hover); a saved one shows the close button.
 */
export function FileTabs({
  tabs,
  active,
  onActivate,
  onClose,
}: {
  tabs: readonly OpenFile[];
  active?: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  useLocale();
  return (
    <div
      role="tablist"
      aria-label={t("files.tabs")}
      className="flex flex-none overflow-x-auto border-b border-hairline"
    >
      {tabs.map((f) => {
        const selected = f.path === active;
        const dirty = isDirty(f);
        const name = baseName(f.path);
        const { Icon, className } = fileIcon(name);
        return (
          <div
            key={f.path}
            className={cn(
              "group relative flex h-9 flex-none items-center border-r border-hairline",
              selected ? "bg-ground text-ink" : "bg-panel text-ink-2 hover:text-ink",
            )}
          >
            {selected && (
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-focus" />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={f.path}
              onClick={() => onActivate(f.path)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(f.path);
              }}
              className="inline-flex h-full items-center gap-1.5 pr-1 pl-3 font-mono text-xs whitespace-nowrap"
            >
              <Icon size={13} aria-hidden="true" className={cn("flex-none", className)} />
              {name}
              {dirty && <span className="sr-only"> ({t("files.unsaved")})</span>}
            </button>
            <button
              type="button"
              aria-label={t("files.closeTab", { name })}
              title={t("files.closeTab", { name })}
              onClick={() => onClose(f.path)}
              className="relative mr-1.5 inline-flex size-5 items-center justify-center rounded text-ink-3 hover:bg-panel-2 hover:text-ink"
            >
              {dirty && (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-ink-2 group-hover:hidden"
                />
              )}
              <X size={13} aria-hidden="true" className={cn(dirty && "hidden group-hover:block")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
