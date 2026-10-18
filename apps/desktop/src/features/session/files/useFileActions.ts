import { RpcErrors } from "@gravita/protocol/constants";
import { useMemo } from "react";
import { useGateway } from "@/app/providers";
import type { EngineGateway } from "@/infrastructure/engine/EngineGateway";
import { toGatewayError } from "@/infrastructure/engine/GatewayError";
import { t } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { getProjectTabs, isDirty, type OpenFile, updateFile, updateProject } from "./openFiles";

export interface FileActions {
  /** Opens `path` in a tab (or brings its tab forward) and makes it the active one. */
  open(path: string): void;
  activate(path: string): void;
  edit(path: string, text: string): void;
  save(path: string, o?: { overwrite?: boolean }): Promise<void>;
  /** Reads the file again from disk, dropping unsaved edits. */
  reload(path: string): void;
  /** Closes the tab; one with unsaved edits asks first. Returns false when kept open. */
  close(path: string): boolean;
}

export function useFileActions(root: string | undefined): FileActions {
  const gateway = useGateway();
  return useMemo(() => fileActions(gateway, root), [gateway, root]);
}

function fileActions(gateway: EngineGateway, root: string | undefined): FileActions {
  const read = (path: string) => {
    if (!root) return;
    gateway.fsRead({ root, path }).then(
      (r) =>
        updateFile(root, path, (): OpenFile => {
          if (r.kind === "binary") return { path, status: "binary" };
          if (r.kind === "tooLarge") return { path, status: "tooLarge", size: r.size };
          return { path, status: "text", text: r.text, saved: r.text, mtimeMs: r.mtimeMs };
        }),
      (e: unknown) =>
        updateFile(root, path, () => ({
          path,
          status: "error",
          error: describeError(toGatewayError(e)).text,
        })),
    );
  };

  const activate = (path: string) => {
    if (!root) return;
    updateProject(root, (p) => ({ ...p, active: path }));
  };

  return {
    open(path) {
      if (!root) return;
      if (getProjectTabs(root).tabs.some((f) => f.path === path)) return activate(path);
      updateProject(root, (p) => ({
        tabs: [...p.tabs, { path, status: "loading" }],
        active: path,
      }));
      read(path);
    },
    activate,
    edit(path, text) {
      if (!root) return;
      updateFile(root, path, (f) => (f.status === "text" ? { ...f, text } : f));
    },
    async save(path, o) {
      if (!root) return;
      const file = getProjectTabs(root).tabs.find((f) => f.path === path);
      if (file?.status !== "text" || file.saving) return;
      if (!isDirty(file) && !o?.overwrite) return;
      const text = file.text;
      updateFile(root, path, (f) => (f.status === "text" ? { ...f, saving: true } : f));
      try {
        const { mtimeMs } = await gateway.fsWrite({
          root,
          path,
          text,
          ...(o?.overwrite ? {} : { expectedMtimeMs: file.mtimeMs }),
        });
        updateFile(root, path, (f) => {
          if (f.status !== "text") return f;
          const { saveError: _e, conflict: _c, ...rest } = f;
          // Edits typed while the save was on its way stay unsaved.
          return { ...rest, saved: text, mtimeMs, saving: false };
        });
      } catch (e) {
        const err = toGatewayError(e);
        updateFile(root, path, (f) =>
          f.status !== "text"
            ? f
            : err.code === RpcErrors.fileConflict.code
              ? { ...f, saving: false, conflict: true }
              : { ...f, saving: false, saveError: describeError(err).text },
        );
      }
    },
    reload(path) {
      if (!root) return;
      updateFile(root, path, () => ({ path, status: "loading" }));
      read(path);
    },
    close(path) {
      if (!root) return true;
      const { tabs, active } = getProjectTabs(root);
      const i = tabs.findIndex((f) => f.path === path);
      const file = tabs[i];
      if (!file) return true;
      if (isDirty(file) && !window.confirm(t("files.discard", { name: baseName(path) })))
        return false;
      const rest = tabs.filter((f) => f.path !== path);
      // Closing the active tab moves to its neighbour, as an editor does.
      const next = active === path ? (rest[i] ?? rest[i - 1])?.path : active;
      updateProject(root, () => ({ tabs: rest, ...(next ? { active: next } : {}) }));
      return true;
    },
  };
}

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
