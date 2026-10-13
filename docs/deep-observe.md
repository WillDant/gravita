# Deep Observe (optional Claude Code plugin)

Gravita sees the Claude Code sessions you run in a terminal by reading their transcripts. Transcripts don't say when an agent is stuck on a permission dialog, so without help those sessions never show up in **Needs you**. Deep Observe is a small Claude Code plugin that fills that gap: a few hooks that tell Gravita, on your machine, what each agent is doing as it happens.

It's optional. Everything else in Gravita works without it.

## What it does

The plugin registers async command hooks for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Notification` (only `permission_prompt`), `SubagentStop`, `Stop` and `SessionEnd`. Each one runs `hooks/forward.sh`, which:

1. Reads the hook's JSON from stdin.
2. Reads the port and hook token from `~/.gravita/runtime.json` (written by the running engine, mode 0600).
3. Sends the JSON to `http://127.0.0.1:<port>/hooks` with `Authorization: Bearer <hook token>`, giving up after 0.4 s.
4. If Gravita isn't running (or doesn't answer), appends the JSON as one line to `~/.gravita/spool/hooks.jsonl` (folder 0700, file 0600, capped at about 5 MB). The engine reads and deletes that file when it starts, and every 30 s while it runs.

The hooks only observe. The script never prints anything (so nothing reaches the conversation), always exits 0 (so it can't show an error or block a tool), and runs async, so Claude Code doesn't wait for it. Hooks never allow or deny anything: Claude Code shows its own dialog and you answer it there. Gravita only shows that an agent is waiting.

Sessions that Gravita starts itself (`GRAVITA_MANAGED=1`) are skipped; Gravita already sees those directly.

## What Gravita does with it

| Hook | Becomes | Notes |
| --- | --- | --- |
| `PreToolUse` | `tool.started` (and `todo.updated` for TodoWrite) | Same key and data as the transcript line for that call, so it's stored once, whichever arrives first. |
| `PostToolUse` | `tool.completed` (ok), and `agent.completed` for an Agent call | Same key as the transcript. No pointer to the full output (the hook doesn't know the transcript line). |
| `PostToolUseFailure` | `tool.completed` (failed, with the error) | |
| `PermissionRequest`, `Notification` (`permission_prompt`) | `permission.requested` on the agent that asks (main or the subagent's `agent_id`) | The agent shows as waiting and the session appears in Needs you. Both hooks for the same dialog count once. |
| `SessionStart` (startup, clear) | `session.started`, kind external | Its own key, so the transcript's line (with branch and CLI version) still applies. Resume and compact are ignored. |
| `PostToolUse` of the same call | `permission.resolved`, allow | |
| `PostToolUseFailure` of the same call, the agent's next tool (after 1 s), `Stop`, `SubagentStop`, `UserPromptSubmit`, `SessionEnd` | `permission.resolved`, deny | `by: "hook"`. A parallel call finishing never ends another call's dialog. |
| `SubagentStop`, `Stop`, `UserPromptSubmit`, `SessionEnd` | nothing else | Only used to tell that a dialog is over. The transcript already reports turns and completions, with more detail. |

Any other hook event is ignored. Events land in the same project as the transcript (resolved from `cwd`). A dialog that was still open when Gravita restarted is recovered and resolved by the next of these hooks. Spooled hooks are replayed in order; a spooled permission dialog older than a minute is not shown.

## Privacy

- Nothing leaves your machine: the engine listens on 127.0.0.1 only, and the token travels in a header (never on the command line, where other users could see it).
- The `/hooks` route accepts only the hook token, refuses any request from a web page (an `Origin` header) and bodies over 256 KB.
- Gravita never reads or stores your prompt text from `UserPromptSubmit`. Like transcripts, tool inputs and results are kept only as short previews.
- The spool holds raw hook JSON (tool inputs and results included) until Gravita reads it. It lives in `~/.gravita/spool`, readable only by you. Set `GRAVITA_HOME` to move `~/.gravita`.
- Nothing is written under `~/.claude` or in the plugin's folder.

## Install

In Claude Code:

```
/plugin marketplace add WillDant/gravita
/plugin install deep-observe@gravita
```

On Claude Code 2.1.275 or later, one step works too: `/plugin install deep-observe --marketplace WillDant/gravita`. From a local checkout, use `/plugin marketplace add /path/to/gravita`. Sessions you start after installing are observed.

Gravita never installs the plugin for you: it goes through Claude Code's own `/plugin` flow, and you can review `plugins/deep-observe` before installing. It needs `sh` and `curl` (without curl, every hook is spooled).

## Uninstall

```
/plugin uninstall deep-observe@gravita
```

Or `/plugin disable deep-observe@gravita` to pause it. To remove what it left behind, delete `~/.gravita/spool`.

## Limits

- `SessionEnd` hooks get about 1.5 s before Claude Code exits; the script's 0.4 s timeout fits. Raise `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` if your machine is slow. A lost `SessionEnd` costs little: Gravita still sees the process exit and stops showing that session as waiting.
- Hooks are async, so two that fire a few milliseconds apart can arrive swapped. Gravita ties a dialog to its call by tool use id or by tool and input, and treats another tool starting within 1 s of a dialog as reordering, not an answer.
- Whether a dialog was allowed or denied is inferred (did the call run?). If you press Esc on a dialog, it shows as resolved when the agent's next hook arrives.
- Gravita doesn't answer dialogs for these sessions; you answer them in the terminal.
