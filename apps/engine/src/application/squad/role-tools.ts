import { z } from "zod";
import type { RoleTool, ToolReply } from "../ports/chat-runtime";

// The tools a role session gets from Gravita (the `gravita` MCP server). Each session's set
// is bound by closure to its squad, role, task and attempt: no argument names a role or a
// task to act for, so an agent can never complete, block or speak for another role.

export interface RoleBinding {
  squadId: string;
  roleId: string;
  taskId: string;
  attempt: number;
}

/** What the tools do; the orchestrator's desk implements it. */
export interface RoleToolHost {
  whoami(b: RoleBinding): ToolReply;
  brief(b: RoleBinding): ToolReply;
  task(b: RoleBinding, taskId?: string): ToolReply;
  tasks(b: RoleBinding): ToolReply;
  progress(b: RoleBinding, text: string): ToolReply;
  complete(b: RoleBinding, summary: string): Promise<ToolReply>;
  yieldBlocked(b: RoleBinding, reason: string): ToolReply;
  postNote(b: RoleBinding, text: string, toRole?: string): ToolReply;
  readNotes(b: RoleBinding): ToolReply;
  readContract(b: RoleBinding, path: string): Promise<ToolReply>;
  proposeContractChange(b: RoleBinding, path: string, rationale: string): ToolReply;
  requestChange(b: RoleBinding, toRole: string, text: string): ToolReply;
  reportBug(b: RoleBinding, paths: string[], text: string): ToolReply;
  integrationStatus(b: RoleBinding): Promise<ToolReply>;
}

const text = (max: number) => z.string().min(1).max(max);
const str = (args: Record<string, unknown>, key: string) => String(args[key] ?? "");

/** The tool set of one role session. */
export function roleTools(host: RoleToolHost, b: RoleBinding): RoleTool[] {
  const t = (
    name: string,
    description: string,
    input: z.ZodRawShape,
    handler: (args: Record<string, unknown>) => ToolReply | Promise<ToolReply>,
  ): RoleTool => ({ name, description, input, handler: async (args) => handler(args) });

  return [
    t("whoami", "Your role, task, attempt, worktree and the paths you own.", {}, () =>
      host.whoami(b),
    ),
    t(
      "get_brief",
      "The squad's goal, the user's brief and answers, the roles and the contracts.",
      {},
      () => host.brief(b),
    ),
    t(
      "get_task",
      "A task's details and status: yours by default, or another by id.",
      { taskId: z.string().max(40).optional() },
      (a) => host.task(b, typeof a.taskId === "string" ? a.taskId : undefined),
    ),
    t("list_tasks", "Every task of the squad with its role, status and dependencies.", {}, () =>
      host.tasks(b),
    ),
    t(
      "report_progress",
      "Tell the user, in plain language, what you just finished or are doing now.",
      { text: text(500) },
      (a) => host.progress(b, str(a, "text")),
    ),
    t(
      "complete_task",
      "Finish your task: Gravita checks that you only changed your own paths, commits your work and queues it for merge. On success, end your turn.",
      { summary: text(1_000) },
      (a) => host.complete(b, str(a, "summary")),
    ),
    t(
      "yield_blocked",
      "You can't go on without the user or another role: say why. Gravita tells the user; then end your turn.",
      { reason: text(1_000) },
      (a) => host.yieldBlocked(b, str(a, "reason")),
    ),
    t(
      "post_note",
      "Leave a note for one role (toRole) or for everyone: decisions, gotchas, what you changed that others use.",
      { text: text(2_000), toRole: z.string().max(24).optional() },
      (a) => host.postNote(b, str(a, "text"), typeof a.toRole === "string" ? a.toRole : undefined),
    ),
    t("read_notes", "Notes from the other roles to you or to everyone.", {}, () =>
      host.readNotes(b),
    ),
    t(
      "read_contract",
      "Read a contract file (or any file) as merged on the integration branch.",
      { path: text(200) },
      (a) => host.readContract(b, str(a, "path")),
    ),
    t(
      "propose_contract_change",
      "Ask a contract's owner to change it (contracts are frozen; only the owner edits them).",
      { path: text(200), rationale: text(2_000) },
      (a) => host.proposeContractChange(b, str(a, "path"), str(a, "rationale")),
    ),
    t(
      "request_change",
      "Ask another role to change something in the paths it owns; it becomes a task for that role.",
      { toRole: z.string().min(1).max(24), text: text(2_000) },
      (a) => host.requestChange(b, str(a, "toRole"), str(a, "text")),
    ),
    t(
      "report_bug",
      "Report a bug in files you don't own; it becomes a task for the role that owns them.",
      { paths: z.array(text(200)).min(1).max(24), text: text(2_000) },
      (a) => host.reportBug(b, Array.isArray(a.paths) ? a.paths.map(String) : [], str(a, "text")),
    ),
    t(
      "get_integration_status",
      "The integration branch: recent merges, check results and frozen contracts.",
      {},
      () => host.integrationStatus(b),
    ),
  ];
}
