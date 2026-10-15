import type { AgentProvider } from "@gravita/protocol";

// Which agent a command line is. A shell terminal runs whatever the user types, so the
// foreground process tells: `claude`, `codex` or `cursor-agent`, started directly or through
// the runtime that runs their script (node, bun, or a shell wrapper).

const RUNTIMES = new Set(["node", "bun", "deno", "sh", "bash", "zsh", "dash"]);

/** What a path says about the agent it belongs to, from its file and folder names. */
function providerOfPath(path: string): AgentProvider | undefined {
  const parts = path.split("/").filter(Boolean);
  const file = (parts.at(-1) ?? "").replace(/\.(c|m)?js$/, "");
  if (file === "claude" || file === "claude-code") return "claude";
  if (file === "codex") return "codex";
  if (file === "cursor-agent") return "cursor";
  if (parts.includes("claude-code")) return "claude";
  if (parts.includes("cursor-agent")) return "cursor";
  if (parts.some((p, i) => p === "@openai" && (parts[i + 1] ?? "").startsWith("codex")))
    return "codex";
  return undefined;
}

/**
 * The agent a `ps` command line runs, if it is one: judged by the program (and, for a
 * runtime, the script it runs), never by the arguments, so `vim claude.md` is not Claude.
 */
export function providerOfCommand(commandLine: string): AgentProvider | undefined {
  const [program = "", script = ""] = commandLine.trim().split(/\s+/);
  const base = program.split("/").filter(Boolean).at(-1) ?? "";
  if (RUNTIMES.has(base)) return script ? providerOfPath(script) : undefined;
  return providerOfPath(program);
}

/** The agent among a foreground process group's commands. */
export function providerOfCommands(lines: readonly string[]): AgentProvider | undefined {
  for (const line of lines) {
    const provider = providerOfCommand(line);
    if (provider) return provider;
  }
  return undefined;
}
