import type { FsEntry } from "@gravita/protocol";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@/app/providers";
import { toGatewayError } from "@/infrastructure/engine/GatewayError";
import { t, useLocale } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { basename, cn } from "@/shared/utils";
import { type FileIcon, fileIcon, folderIcon } from "./fileIcon";

type Listing = { entries: FsEntry[] } | { error: string };

/**
 * The project's files as a tree, in the session's right pane. Folders are read when first
 * opened; pressing a file opens it in the editor.
 */
export function Explorer({
  root,
  activePath,
  onOpen,
}: {
  root: string;
  activePath?: string;
  onOpen: (path: string) => void;
}) {
  useLocale();
  const gateway = useGateway();
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([""]));
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (path: string) =>
      gateway.fsList({ root, path }).then(
        (r) => setListings((l) => ({ ...l, [path]: { entries: r.entries } })),
        (e: unknown) =>
          setListings((l) => ({ ...l, [path]: { error: describeError(toGatewayError(e)).text } })),
      ),
    [gateway, root],
  );

  useEffect(() => {
    setListings({});
    setExpanded(new Set([""]));
    void load("");
  }, [load]);

  const toggle = (path: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(path)) {
        next.add(path);
        if (!listings[path]) void load(path);
      }
      return next;
    });
  };

  // Reads every open folder again (files made or removed since).
  const refresh = () => {
    setLoading(true);
    void Promise.all([...expanded].map(load)).finally(() => setLoading(false));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {basename(root)}
        </h2>
        <button
          type="button"
          aria-label={t("files.refresh")}
          title={t("files.refresh")}
          aria-busy={loading}
          onClick={refresh}
          className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink"
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={cn(loading && "motion-safe:animate-spin")}
          />
        </button>
      </div>
      <div role="tree" aria-label={t("files.tree")} className="min-h-0 flex-1 overflow-auto pb-3">
        <FolderItems
          path=""
          depth={0}
          listings={listings}
          expanded={expanded}
          activePath={activePath}
          onToggle={toggle}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

function FolderItems({
  path,
  depth,
  listings,
  expanded,
  activePath,
  onToggle,
  onOpen,
}: {
  path: string;
  depth: number;
  listings: Record<string, Listing>;
  expanded: ReadonlySet<string>;
  activePath?: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const listing = listings[path];
  const indent = { paddingLeft: `${12 + depth * 14}px` };
  if (!listing)
    return (
      <p role="status" style={indent} className="py-1 text-xs text-ink-3">
        {t("files.loading")}
      </p>
    );
  if ("error" in listing)
    return (
      <p role="alert" style={indent} className="py-1 pr-3 text-xs text-error-ink">
        {listing.error}
      </p>
    );
  if (listing.entries.length === 0)
    return (
      <p style={indent} className="py-1 text-xs text-ink-3 italic">
        {t("files.empty")}
      </p>
    );
  return (
    <ul role="group" className="flex flex-col">
      {listing.entries.map((e) => {
        const child = path ? `${path}/${e.name}` : e.name;
        const open = e.kind === "dir" && expanded.has(child);
        const active = e.kind === "file" && child === activePath;
        return (
          <li key={e.name} role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={e.kind === "dir" ? open : undefined}
              aria-selected={active}
              title={child}
              style={indent}
              onClick={() => (e.kind === "dir" ? onToggle(child) : onOpen(child))}
              className={cn(
                "flex h-7 w-full min-w-0 items-center gap-1.5 pr-3 text-left text-sm hover:bg-panel",
                active ? "bg-select text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {e.kind === "dir" ? (
                <>
                  <ChevronRight
                    size={14}
                    aria-hidden="true"
                    className={cn("flex-none text-ink-3 transition-transform", open && "rotate-90")}
                  />
                  <EntryIcon icon={folderIcon(open)} />
                </>
              ) : (
                <>
                  <span className="w-3.5 flex-none" aria-hidden="true" />
                  <EntryIcon icon={fileIcon(e.name)} />
                </>
              )}
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
            </button>
            {open && (
              <FolderItems
                path={child}
                depth={depth + 1}
                listings={listings}
                expanded={expanded}
                activePath={activePath}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EntryIcon({ icon: { Icon, className } }: { icon: FileIcon }) {
  return <Icon size={15} aria-hidden="true" className={cn("flex-none", className)} />;
}
