import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { t, useLocale } from "@/shared/i18n/i18n";
import { Button } from "@/shared/ui/ui";
import type { OpenFile } from "./openFiles";

// The editor for the open file: CodeMirror, loaded with this chunk when the first file opens.
// Its look comes from the app's tokens, so it follows the light and dark themes.

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--ground)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: '"DM Mono", ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: "12.5px",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--ink)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--ground)",
    color: "var(--ink-3)",
    border: "none",
    borderRight: "1px solid var(--hairline)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--panel) 70%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--panel)", color: "var(--ink-2)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--select) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--select)" },
  ".cm-matchingBracket": {
    backgroundColor: "var(--panel-2)",
    outline: "1px solid var(--hairline-strong)",
  },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--ink)" },
  ".cm-searchMatch": { backgroundColor: "var(--waiting-bg)", outline: "1px solid var(--waiting)" },
  ".cm-tooltip": {
    backgroundColor: "var(--ground)",
    border: "1px solid var(--hairline)",
    boxShadow: "var(--shadow)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--panel-2)",
    border: "none",
    color: "var(--ink-2)",
  },
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  { tag: [tags.comment, tags.meta], color: "var(--ink-3)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--code-function)",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--code-type)" },
  { tag: [tags.tagName, tags.heading], color: "var(--code-keyword)", fontWeight: "600" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-property)" },
  { tag: tags.link, color: "var(--focus)", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.invalid, color: "var(--error-ink)" },
]);

/** The file's language, loaded on demand (each grammar is its own chunk). */
function loadLanguage(path: string): Promise<Extension> {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true }));
    case "tsx":
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      );
    case "js":
    case "mjs":
    case "cjs":
      return import("@codemirror/lang-javascript").then((m) => m.javascript());
    case "jsx":
      return import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true }));
    case "json":
    case "jsonc":
      return import("@codemirror/lang-json").then((m) => m.json());
    case "css":
    case "scss":
      return import("@codemirror/lang-css").then((m) => m.css());
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return import("@codemirror/lang-html").then((m) => m.html());
    case "md":
    case "mdx":
      return import("@codemirror/lang-markdown").then((m) => m.markdown());
    case "py":
      return import("@codemirror/lang-python").then((m) => m.python());
    case "rs":
      return import("@codemirror/lang-rust").then((m) => m.rust());
    case "yml":
    case "yaml":
      return import("@codemirror/lang-yaml").then((m) => m.yaml());
    default:
      return Promise.resolve([]);
  }
}

/** Where each state's language goes once it has loaded. */
const language = new Compartment();

export default function FileEditor({
  file,
  onChange,
  onSave,
  onReload,
  onOverwrite,
}: {
  file: OpenFile;
  onChange: (text: string) => void;
  onSave: () => void;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  useLocale();
  if (file.status === "loading")
    return (
      <p role="status" className="px-6 py-4 text-sm text-ink-2">
        {t("files.loading")}
      </p>
    );
  if (file.status === "error")
    return (
      <p role="alert" className="px-6 py-4 text-sm text-error-ink">
        {file.error}
      </p>
    );
  if (file.status === "binary")
    return <p className="px-6 py-4 text-sm text-ink-2">{t("files.binary")}</p>;
  if (file.status === "tooLarge")
    return (
      <p className="px-6 py-4 text-sm text-ink-2">
        {t("files.tooLarge", { size: (file.size / 1024 / 1024).toFixed(1) })}
      </p>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {file.conflict && (
        <div
          role="alert"
          className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-waiting-bg px-4 py-2 text-sm text-waiting-ink"
        >
          <span className="min-w-0 flex-1">{t("files.conflict")}</span>
          <Button onClick={onReload}>{t("files.reload")}</Button>
          <Button onClick={onOverwrite}>{t("files.overwrite")}</Button>
        </div>
      )}
      {file.saveError && (
        <p
          role="alert"
          className="flex-none border-b border-hairline bg-error-bg px-4 py-2 text-sm text-error-ink"
        >
          {file.saveError}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <CodeEditor path={file.path} text={file.text} onChange={onChange} onSave={onSave} />
      </div>
    </div>
  );
}

/**
 * One CodeMirror view for every tab: switching tabs swaps in that file's own state, so each
 * keeps its cursor, scroll and undo history.
 */
function CodeEditor({
  path,
  text,
  onChange,
  onSave,
}: {
  path: string;
  text: string;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const states = useRef(new Map<string, EditorState>());
  const shown = useRef<string>(undefined);
  /** The text this editor last reported, so a render caused by typing skips the compare. */
  const emitted = useRef<string>(undefined);
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  const create = (doc: string, forPath: string) =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        Prec.highest(
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
          ]),
        ),
        theme,
        syntaxHighlighting(highlight),
        language.of([]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || shown.current !== forPath) return;
          emitted.current = u.state.doc.toString();
          handlers.current.onChange(emitted.current);
        }),
      ],
    });

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({ parent: host.current });
    view.current = v;
    return () => {
      // A remount (StrictMode does one in dev) gets a fresh, empty view: keep this file's
      // state and forget it was shown, so the next view takes it back.
      if (shown.current) states.current.set(shown.current, v.state);
      shown.current = undefined;
      v.destroy();
      view.current = null;
    };
  }, []);

  // The language arrives after the text; a tab switched away from in between gets it on return.
  const withLanguage = (forPath: string) =>
    void loadLanguage(forPath).then(
      (ext) => {
        if (shown.current === forPath)
          view.current?.dispatch({ effects: language.reconfigure(ext) });
      },
      () => {},
    );

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (shown.current !== path) {
      if (shown.current) states.current.set(shown.current, v.state);
      const cached = states.current.get(path);
      shown.current = path;
      emitted.current = text;
      v.setState(cached && cached.doc.toString() === text ? cached : create(text, path));
      withLanguage(path);
      v.focus();
    } else if (text !== emitted.current && v.state.doc.toString() !== text) {
      // Read again from disk (a reload): the editor takes the file's new contents.
      emitted.current = text;
      v.setState(create(text, path));
      withLanguage(path);
    }
  });

  return <div ref={host} className="h-full" />;
}
