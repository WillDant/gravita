// Just enough shell parsing to judge what a Bash call would run: a line is split into its
// simple commands (on ; & | && || newlines and parentheses), quotes are honoured, command
// substitutions ($(…) and backticks) and `sh -c "…"` / `eval` are parsed as commands of
// their own, and wrappers (env assignments, sudo, env, time, nohup, xargs…) are peeled off.
// It is a guard, not a shell: anything it can't read stays in the words (a "$" marks an
// expansion) so the policy can refuse what it can't resolve.

const OPERATORS = new Set([";", "&", "|", "(", ")", "\n"]);
const REDIRECTS = new Set([">", "<"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Programs that run the rest of their arguments as a command. */
const WRAPPERS = new Set([
  "sudo",
  "command",
  "builtin",
  "exec",
  "time",
  "nohup",
  "nice",
  "env",
  "xargs",
  "timeout",
  "caffeinate",
]);
/** Wrapper options that take the next word as their value ("sudo -u alice"). */
const WRAPPER_VALUE_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"]),
  env: new Set(["-u", "-C", "-S"]),
  nice: new Set(["-n"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  xargs: new Set(["-n", "-I", "-L", "-P", "-d", "-E", "-s", "-a"]),
};
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const MAX_DEPTH = 4;

/** Reads `text` from `start` (just after the opener) to its matching ")"; returns the end index. */
function closingParen(text: string, start: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return text.length;
}

/** One simple command: its words, and the files its output redirections write. */
export interface ShellCommand {
  argv: string[];
  /** Targets of `>` / `>>` (not `<`, not fd duplications like `2>&1`). */
  writes: string[];
}

interface Lexed {
  /** Each simple command, wrappers still on. */
  commands: ShellCommand[];
  /** Command substitutions found inside, to be parsed on their own. */
  nested: string[];
}

function lex(line: string): Lexed {
  const commands: ShellCommand[] = [];
  const nested: string[] = [];
  let cur: ShellCommand = { argv: [], writes: [] };
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  /** The next word is a redirection target: "out" is written, "in" only read. */
  let target: "out" | "in" | null = null;

  const endWord = () => {
    if (inWord) {
      if (target === "out") cur.writes.push(word);
      else if (target === null) cur.argv.push(word);
      target = null;
    }
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    target = null;
    if (cur.argv.length || cur.writes.length) commands.push(cur);
    cur = { argv: [], writes: [] };
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    // Command substitution runs even inside double quotes.
    if (c === "$" && line[i + 1] === "(") {
      const end = closingParen(line, i + 2);
      nested.push(line.slice(i + 2, end));
      word += "$(…)";
      inWord = true;
      i = end;
      continue;
    }
    if (c === "`") {
      const end = line.indexOf("`", i + 1);
      const stop = end < 0 ? line.length : end;
      nested.push(line.slice(i + 1, stop));
      word += "$(…)";
      inWord = true;
      i = stop;
      continue;
    }
    if (c === "\\") {
      const next = line[i + 1];
      if (next === "\n") i++;
      else if (next !== undefined) {
        word += next;
        inWord = true;
        i++;
      }
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      continue;
    }
    if (OPERATORS.has(c)) {
      endCommand();
      continue;
    }
    if (REDIRECTS.has(c)) {
      // "2>file": the fd digits are not an argument.
      if (/^\d+$/.test(word)) {
        word = "";
        inWord = false;
      }
      endWord();
      let j = i + 1;
      while (line[j] === ">" || line[j] === "<") j++;
      if (line[j] === "&") {
        // ">&2", "2>&1": a duplication, no file.
        j++;
        while (/[\d-]/.test(line[j] ?? "")) j++;
      } else target = c === ">" ? "out" : "in";
      i = j - 1;
      continue;
    }
    word += c;
    inWord = true;
  }
  endCommand();
  return { commands, nested };
}

/** Removes env assignments and wrapper programs (with their options) from the front. */
function unwrap(words: string[]): string[] {
  let w = words;
  for (;;) {
    while (w.length && ASSIGNMENT.test(w[0] as string)) w = w.slice(1);
    const head = w[0];
    if (head === undefined) return w;
    const prog = basename(head);
    if (!WRAPPERS.has(prog)) return w;
    w = w.slice(1);
    // Wrapper options ("sudo -u x", "timeout 10", "env -i", "xargs -n1").
    const valued = WRAPPER_VALUE_OPTIONS[prog];
    while (w.length && ((w[0] as string).startsWith("-") || /^\d+[smhd]?$/.test(w[0] as string)))
      w = w.slice(valued?.has(w[0] as string) ? 2 : 1);
  }
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Every simple command a Bash line would run (wrappers removed), including the ones inside
 * command substitutions and `sh -c` strings.
 */
export function simpleCommands(line: string, depth = 0): ShellCommand[] {
  if (depth > MAX_DEPTH) return [];
  const { commands, nested } = lex(line);
  const out: ShellCommand[] = [];
  for (const raw of commands) {
    const argv = unwrap(raw.argv);
    out.push({ argv, writes: raw.writes });
    if (!argv.length) continue;
    const prog = basename(argv[0] as string);
    if (prog === "eval") out.push(...simpleCommands(argv.slice(1).join(" "), depth + 1));
    if (SHELLS.has(prog)) {
      const at = argv.findIndex((a, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(a));
      const script = at > 0 ? argv[at + 1] : undefined;
      if (script) out.push(...simpleCommands(script, depth + 1));
    }
  }
  for (const inner of nested) out.push(...simpleCommands(inner, depth + 1));
  return out;
}
