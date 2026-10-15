import { FolderOpen } from "lucide-react";
import { type RefObject, useId } from "react";
import { usePickFolder } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn, tildify } from "@/shared/utils";

export interface RecentFolder {
  name: string;
  root: string;
}

/**
 * Read-only project folder: native picker, recent chips, or a path already known from context.
 * The path is never typed.
 */
export function FolderField({
  idPrefix,
  folder,
  onFolder,
  invalid,
  errorText,
  hintText,
  recent = [],
  focusRef,
}: {
  idPrefix?: string;
  folder: string;
  onFolder: (path: string) => void;
  invalid?: boolean;
  /** Shown when invalid; omit to show nothing on error. */
  errorText?: string;
  /** Shown when valid; used by squad for a persistent hint. */
  hintText?: string;
  recent?: RecentFolder[];
  /** Focus target when validation asks for the folder (button, not a text field). */
  focusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const uid = useId();
  const fieldId = idPrefix ?? uid;
  const pickFolder = usePickFolder();
  const hasFolder = folder.trim().length > 0;
  const describedBy =
    invalid && errorText
      ? `${fieldId}-folder-err`
      : hintText
        ? `${fieldId}-folder-hint`
        : undefined;

  const choose = () => {
    pickFolder?.().then(
      (path) => {
        if (path) onFolder(path);
      },
      () => {},
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${fieldId}-folder-label`} className="text-xs font-semibold text-ink-2">
        {t("newSession.folder")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {pickFolder ? (
          <button
            ref={focusRef}
            type="button"
            id={`${fieldId}-folder`}
            aria-labelledby={`${fieldId}-folder-label`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onClick={choose}
            className={cn(
              fieldFrame,
              "min-w-[260px] flex-1 cursor-pointer text-left transition-colors hover:bg-panel/40",
              invalid && "ring-1 ring-error-ink",
            )}
          >
            <span
              className={cn(
                "flex h-8 items-center px-2.5",
                hasFolder ? "font-mono text-xs text-ink" : "font-sans text-sm text-ink-3",
              )}
              title={hasFolder ? tildify(folder) : undefined}
            >
              <span className="truncate">
                {hasFolder ? tildify(folder) : t("newSession.folderEmpty")}
              </span>
            </span>
          </button>
        ) : (
          <div
            id={`${fieldId}-folder`}
            role="group"
            aria-labelledby={`${fieldId}-folder-label`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(fieldFrame, "min-w-[260px] flex-1", invalid && "ring-1 ring-error-ink")}
          >
            <span
              className={cn(
                "flex h-8 items-center px-2.5",
                hasFolder ? "font-mono text-xs text-ink" : "font-sans text-sm text-ink-3",
              )}
              title={hasFolder ? tildify(folder) : undefined}
            >
              <span className="truncate">
                {hasFolder ? tildify(folder) : t("newSession.folderEmpty")}
              </span>
            </span>
          </div>
        )}
        {pickFolder && (
          <Button type="button" onClick={choose}>
            <FolderOpen size={15} aria-hidden="true" />
            {t("newSession.chooseFolder")}
          </Button>
        )}
      </div>
      {invalid && errorText && (
        <p id={`${fieldId}-folder-err`} className="text-xs text-error-ink">
          {errorText}
        </p>
      )}
      {!invalid && hintText && (
        <p id={`${fieldId}-folder-hint`} className="text-xs text-ink-3">
          {hintText}
        </p>
      )}
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-ink-3">{t("newSession.recent")}</span>
          {recent.map((r) => (
            <button
              key={r.root}
              type="button"
              title={tildify(r.root)}
              aria-pressed={folder === r.root}
              onClick={() => onFolder(r.root)}
              className={cn(
                "h-6 max-w-[220px] truncate rounded-full px-2.5 text-xs font-medium transition-colors",
                folder === r.root
                  ? "bg-ink text-ground"
                  : "bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink",
              )}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
