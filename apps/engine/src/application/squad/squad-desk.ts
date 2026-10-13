import { normalizePath, ownerOf, type SquadState, squadPlan } from "@gravita/core";
import { keys, MAIN_AGENT, type PlanTask, type SquadPlan } from "@gravita/protocol";
import { MAX_BOUNCES } from "../../domain/squad-policy";
import type { ToolReply } from "../ports/chat-runtime";
import type { Clock } from "../ports/clock";
import type { GitWorkspace } from "../ports/git-workspace";
import type { SquadReader } from "../ports/squad-reader";
import type { MergeQueue } from "../services/merge-queue";
import type { CommitTask } from "../usecases/commit-task";
import type { IngestEvents } from "../usecases/ingest-events";
import type { RunChecks } from "../usecases/run-checks";
import { tailBytes } from "../usecases/run-checks";
import type { RoleBinding, RoleToolHost } from "./role-tools";
import { clip, type SquadEmitter, type SquadRef } from "./squad-emitter";
import type { LiveAttempt } from "./squad-run";

// The role tools' behaviour: what a role can learn about the squad and what it can ask of
// Gravita and the other roles. Every call acts for the binding it was created with.

/** What read_contract returns of a file, at most. */
export const READ_FILE_CAP_BYTES = 64 * 1024;
const NOTES_SHOWN = 30;
const MERGES_SHOWN = 8;
const CHECK_TAIL_BYTES = 4 * 1024;

const ok = (text: string): ToolReply => ({ text });
const fail = (text: string): ToolReply => ({ text, isError: true });
const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`).join("\n");

export interface SquadDeskDeps {
  squads: SquadReader;
  emitter: SquadEmitter;
  commitTask: CommitTask;
  runChecks: RunChecks;
  mergeQueue: MergeQueue;
  git: GitWorkspace;
  ingest: IngestEvents;
  clock: Clock;
  /** The live attempt a binding belongs to, if it is still running. */
  attempt(b: RoleBinding): LiveAttempt | undefined;
  /** New work appeared (a change request, a bug): let the scheduler look. */
  onWorkAdded(squadId: string): void;
  /** The integration worktree of a squad. */
  integrationPath(squadId: string): string | undefined;
}

export class SquadDesk implements RoleToolHost {
  constructor(private readonly d: SquadDeskDeps) {}

  private squad(b: RoleBinding): { q: SquadState; plan: SquadPlan; ref: SquadRef } {
    const q = this.d.squads.squad(b.squadId);
    const plan = q ? squadPlan(q) : undefined;
    if (!q || !plan) throw new Error(`Squad ${b.squadId} has no plan`);
    return { q, plan, ref: { squadId: q.id, projectId: q.projectId } };
  }

  whoami(b: RoleBinding): ToolReply {
    const { plan } = this.squad(b);
    const role = plan.roles.find((r) => r.id === b.roleId);
    const task = plan.tasks.find((t) => t.id === b.taskId);
    const live = this.d.attempt(b);
    return ok(
      [
        `Role: ${role?.name ?? b.roleId} (${b.roleId}, ${role?.kind ?? "custom"})`,
        `Task: ${b.taskId}${task ? ` — ${task.title}` : ""} (attempt ${b.attempt})`,
        `You own: ${role?.owns.join(", ") ?? "nothing"}`,
        ...(live ? [`Worktree: ${live.worktree}`, `Branch: ${live.roleBranch}`] : []),
      ].join("\n"),
    );
  }

  brief(b: RoleBinding): ToolReply {
    const { q, plan } = this.squad(b);
    const answers = Object.entries(q.answers ?? {});
    return ok(
      [
        `Goal: ${plan.goal}`,
        `Summary: ${plan.summary}`,
        `The user's brief: ${q.brief}`,
        ...(answers.length ? [`Answers:\n${bullets(answers.map(([k, v]) => `${k} → ${v}`))}`] : []),
        ...(plan.assumptions.length ? [`Assumptions:\n${bullets(plan.assumptions)}`] : []),
        `Roles:\n${bullets(plan.roles.filter((r) => r.kind !== "planner").map((r) => `${r.id} (${r.name}) owns ${r.owns.join(", ")}`))}`,
        `Shared (Gravita's): ${plan.shared.paths.join(", ") || "none"}`,
        `Contracts:\n${
          plan.contracts.length
            ? bullets(
                plan.contracts.map((c) => {
                  const frozen = q.contracts[c.path];
                  return `${c.path} (${c.kind}, owner ${c.owner}${frozen ? `, frozen v${frozen.version}` : ""})`;
                }),
              )
            : "none"
        }`,
      ].join("\n\n"),
    );
  }

  task(b: RoleBinding, taskId?: string): ToolReply {
    const { q, plan } = this.squad(b);
    const id = taskId ?? b.taskId;
    const t = plan.tasks.find((x) => x.id === id);
    if (!t) return fail(`No task "${id}". Call list_tasks to see them.`);
    const s = q.tasks[id];
    const dep = (d: string) => `${d} (${q.tasks[d]?.status ?? "pending"})`;
    return ok(
      [
        `${t.id}: ${t.title}`,
        `Role: ${s?.role ?? t.role} · status ${s?.status ?? "pending"} · attempt ${s?.attempt ?? 1}`,
        `For the user: ${t.plainSummary}`,
        `Writes:\n${bullets(t.writes)}`,
        `Done when:\n${bullets(t.acceptance)}`,
        `Depends on: ${t.dependsOn.length ? t.dependsOn.map(dep).join(", ") : "nothing"}`,
        ...(s?.reason ? [`Last note: ${s.reason}`] : []),
      ].join("\n"),
    );
  }

  tasks(b: RoleBinding): ToolReply {
    const { q, plan } = this.squad(b);
    return ok(
      plan.tasks
        .map((t) => {
          const s = q.tasks[t.id];
          const deps = t.dependsOn.length ? ` (after ${t.dependsOn.join(", ")})` : "";
          return `${t.id} [${s?.status ?? "pending"}] ${s?.role ?? t.role} — ${t.title}${deps}`;
        })
        .join("\n"),
    );
  }

  progress(b: RoleBinding, text: string): ToolReply {
    const live = this.d.attempt(b);
    const sessionId = live?.session?.sessionId;
    if (!live || !sessionId) return ok("Noted.");
    live.progressCount++;
    this.d.ingest.execute([
      {
        key: keys.roleProgress(b.squadId, b.taskId, b.attempt, live.progressCount),
        ts: this.d.clock.iso(),
        source: "gravita",
        provider: "claude",
        projectId: live.projectId,
        sessionId,
        agentId: MAIN_AGENT,
        type: "agent.progress",
        data: { summary: clip(text, 500) },
      },
    ]);
    return ok("Noted. Keep going.");
  }

  async complete(b: RoleBinding, summary: string): Promise<ToolReply> {
    const live = this.d.attempt(b);
    if (!live) return fail("This task isn't running anymore. End your turn.");
    if (live.completion) return ok("Already done and queued for merge. End your turn now.");
    if (live.failed) return fail(live.failed);
    const { plan, ref } = this.squad(b);
    const bounce = live.bounces + 1;
    const res = await this.d.commitTask.execute({
      squadId: b.squadId,
      projectId: live.projectId,
      plan,
      roleId: b.roleId,
      taskId: b.taskId,
      attempt: b.attempt,
      worktree: live.worktree,
      base: live.integrationBranch,
      bounce,
    });
    if (!res.ok) {
      return this.bounce(
        live,
        `You changed files outside what you own:\n${bullets(res.violation)}\nUndo those changes (git restore <path> for files that existed, delete the ones you created). If the change is needed, ask the owner with request_change. Then call complete_task again.`,
      );
    }

    if (res.sha) {
      const red = await this.taskChecks(live, plan, bounce);
      if (red) return this.bounce(live, red);
    }
    this.d.emitter.taskStatus(ref, {
      taskId: b.taskId,
      status: "review",
      attempt: b.attempt,
      role: b.roleId,
      ...(live.session ? { sessionId: live.session.sessionId } : {}),
      reason: summary,
    });
    if (!res.sha) {
      live.completion = { sha: null, summary };
      return ok("There was nothing to commit, so the task is recorded as done. End your turn now.");
    }
    live.completion = {
      sha: res.sha,
      summary,
      merge: this.d.mergeQueue.enqueue({
        squadId: b.squadId,
        projectId: live.projectId,
        plan,
        roleId: b.roleId,
        taskId: b.taskId,
        attempt: b.attempt,
        roleBranch: live.roleBranch,
      }),
    };
    // The runner awaits it; an unobserved rejection must not crash the engine meanwhile.
    live.completion.merge?.catch(() => {});
    const restored = res.restored.length
      ? ` Shared files you changed (${res.restored.join(", ")}) were put back; Gravita regenerates them.`
      : "";
    return ok(
      `Committed ${res.sha.slice(0, 8)} (${res.files.length} file${res.files.length === 1 ? "" : "s"}).${restored} Gravita queued it for merge into integration. End your turn now.`,
    );
  }

  /** Sends complete_task back to the role, or fails the task after too many tries. */
  private bounce(live: LiveAttempt, why: string): ToolReply {
    live.bounces++;
    if (live.bounces > MAX_BOUNCES) {
      live.failed = `complete_task was sent back ${live.bounces} times; the task has failed and goes to the user. Last reason:\n${why}`;
      return fail(`${live.failed}\nEnd your turn now.`);
    }
    return fail(why);
  }

  /** Runs the plan's task checks in the role's worktree; the failure text, or undefined. */
  private async taskChecks(
    live: LiveAttempt,
    plan: SquadPlan,
    bounce: number,
  ): Promise<string | undefined> {
    if (!plan.checks.some((c) => c.when === "task")) return undefined;
    const results = await this.d.runChecks.execute({
      squadId: live.squadId,
      projectId: live.projectId,
      plan,
      worktree: live.worktree,
      when: "task",
      runId: `task-${live.taskId}-${live.attempt}-${bounce}`,
    });
    const red = results.filter((r) => !r.ok);
    if (!red.length) return undefined;
    return `Your work is committed, but checks failed:\n${red
      .map((r) => `${r.checkId}:\n${tailBytes(r.output, CHECK_TAIL_BYTES)}`)
      .join("\n\n")}\nFix them in your paths and call complete_task again.`;
  }

  yieldBlocked(b: RoleBinding, reason: string): ToolReply {
    const live = this.d.attempt(b);
    if (!live) return fail("This task isn't running anymore. End your turn.");
    live.yielded = reason;
    return ok("Gravita will ask the user. End your turn now.");
  }

  postNote(b: RoleBinding, text: string, toRole?: string): ToolReply {
    const { q, plan, ref } = this.squad(b);
    if (toRole && !plan.roles.some((r) => r.id === toRole))
      return fail(`No role "${toRole}". Roles: ${plan.roles.map((r) => r.id).join(", ")}.`);
    this.d.emitter.note(
      ref,
      nextId(
        q.notes.map((n) => n.noteId),
        "note",
      ),
      b.roleId,
      text,
      toRole,
    );
    return ok(toRole ? `Posted for ${toRole}.` : "Posted for everyone.");
  }

  readNotes(b: RoleBinding): ToolReply {
    const { q } = this.squad(b);
    const mine = q.notes.filter(
      (n) => n.fromRole !== b.roleId && (n.toRole === undefined || n.toRole === b.roleId),
    );
    if (!mine.length) return ok("No notes for you yet.");
    return ok(
      mine
        .slice(-NOTES_SHOWN)
        .map((n) => `[${n.ts}] ${n.fromRole}${n.toRole ? ` → ${n.toRole}` : ""}: ${n.text}`)
        .join("\n"),
    );
  }

  async readContract(b: RoleBinding, path: string): Promise<ToolReply> {
    const rel = normalizePath(path);
    if (!rel || path.startsWith("/") || rel.split("/").includes(".."))
      return fail("Give a repo-relative path, like packages/contracts/openapi.yaml.");
    const integration = this.d.integrationPath(b.squadId);
    if (!integration) return fail("The squad has no integration branch yet.");
    const file = await this.d.git.readFile(integration, "HEAD", rel, READ_FILE_CAP_BYTES);
    if (!file) return fail(`${rel} isn't on the integration branch yet.`);
    return ok(file.truncated ? `${file.text}\n… (cut at ${READ_FILE_CAP_BYTES} bytes)` : file.text);
  }

  proposeContractChange(b: RoleBinding, path: string, rationale: string): ToolReply {
    const { plan } = this.squad(b);
    const contract = plan.contracts.find((c) => normalizePath(c.path) === normalizePath(path));
    if (!contract)
      return fail(
        `"${path}" isn't a contract. Contracts: ${plan.contracts.map((c) => c.path).join(", ") || "none"}.`,
      );
    if (contract.owner === b.roleId)
      return ok(
        "You own this contract: change it in this task, keep it compatible, and tell the others with post_note.",
      );
    return this.requestChange(
      b,
      contract.owner,
      `Contract change for ${contract.path}: ${rationale}`,
    );
  }

  requestChange(b: RoleBinding, toRole: string, text: string): ToolReply {
    const { plan, ref } = this.squad(b);
    const target = plan.roles.find((r) => r.id === toRole && r.kind !== "planner");
    if (!target)
      return fail(
        `No role "${toRole}" can take it. Roles: ${plan.roles
          .filter((r) => r.kind !== "planner")
          .map((r) => r.id)
          .join(", ")}.`,
      );
    if (toRole === b.roleId)
      return fail("That's you: make the change in this task if it's within your paths.");
    const from = plan.roles.find((r) => r.id === b.roleId);
    const id = nextId(
      plan.tasks.map((t) => t.id),
      "cr",
    );
    const task: PlanTask = {
      id,
      role: toRole,
      title: clip(`Change request from ${from?.name ?? b.roleId}`, 80),
      plainSummary: clip(text, 280),
      dependsOn: [],
      writes: target.owns,
      acceptance: [clip(`Done what ${b.roleId} asked: ${text}`, 200)],
      size: "s",
    };
    this.d.emitter.taskAdded(ref, task, "change_request", b.roleId);
    this.d.emitter.changeRequestOpened(ref, {
      requestId: id,
      fromRole: b.roleId,
      toRole,
      text,
      taskId: id,
    });
    this.d.onWorkAdded(b.squadId);
    return ok(
      `Asked ${toRole}: it's task ${id}. Carry on with your own work; if yours can't be finished without it, call yield_blocked.`,
    );
  }

  reportBug(b: RoleBinding, paths: string[], text: string): ToolReply {
    const { plan, ref } = this.squad(b);
    const { byOwner, unowned } = groupByOwner(plan, paths);
    const mine = byOwner.get(b.roleId);
    byOwner.delete(b.roleId);
    if (!byOwner.size)
      return fail(
        mine
          ? "You own those files: fix the bug in this task."
          : `No role owns ${unowned.join(", ")} (shared files are Gravita's). Tell the user with yield_blocked if it blocks you.`,
      );
    const ids = this.addBugTasks(ref, plan, byOwner, text, b.roleId);
    this.d.onWorkAdded(b.squadId);
    const skipped = unowned.length ? ` No role owns ${unowned.join(", ")}.` : "";
    return ok(`Reported as ${ids.join(", ")}.${skipped} Carry on with your own work.`);
  }

  /** One bug task per owner, with its paths; the full report goes to the owner as a note. */
  addBugTasks(
    ref: SquadRef,
    plan: SquadPlan,
    byOwner: ReadonlyMap<string, string[]>,
    text: string,
    fromRole?: string,
  ): string[] {
    const taken = plan.tasks.map((t) => t.id);
    const ids: string[] = [];
    for (const [owner, ownerPaths] of byOwner) {
      const id = nextId(taken, "bug");
      taken.push(id);
      ids.push(id);
      const task: PlanTask = {
        id,
        role: owner,
        title: clip(`Fix a bug reported by ${fromRole ?? "the final checks"}`, 80),
        plainSummary: clip(text, 280),
        dependsOn: [],
        writes: ownerPaths.slice(0, 24),
        acceptance: [clip(`Fixed: ${text}`, 200)],
        size: "s",
      };
      this.d.emitter.taskAdded(ref, task, "bug", fromRole);
      const q = this.d.squads.squad(ref.squadId);
      this.d.emitter.note(
        ref,
        nextId(q?.notes.map((n) => n.noteId) ?? [], "note"),
        fromRole ?? "gravita",
        `Bug ${id}: ${text}`,
        owner,
      );
    }
    return ids;
  }

  async integrationStatus(b: RoleBinding): Promise<ToolReply> {
    const { q, plan } = this.squad(b);
    const integration = this.d.integrationPath(b.squadId);
    const head = integration ? await this.d.git.headSha(integration) : null;
    const merges = Object.values(q.merges)
      .sort((x, y) => (x.ts < y.ts ? -1 : 1))
      .slice(-MERGES_SHOWN)
      .map(
        (m) =>
          `${m.taskId} (${m.role}, attempt ${m.attempt}): ${m.state}${m.sha ? ` ${m.sha.slice(0, 8)}` : ""}`,
      );
    const checks = Object.entries(q.checks).map(
      ([id, c]) => `${id}: ${c.ok ? "green" : "red"} (${c.ts})`,
    );
    const done = plan.tasks.filter((t) => q.tasks[t.id]?.status === "done").length;
    return ok(
      [
        `Integration head: ${head ? head.slice(0, 8) : "none yet"}`,
        `Tasks done: ${done} of ${plan.tasks.length}`,
        `Recent merges:\n${merges.length ? bullets(merges) : "none yet"}`,
        `Checks:\n${checks.length ? bullets(checks) : "none run yet"}`,
        `Frozen contracts: ${
          Object.entries(q.contracts)
            .map(([p, c]) => `${p} v${c.version}`)
            .join(", ") || "none"
        }`,
      ].join("\n\n"),
    );
  }
}

/** `${prefix}-<n>` with the first n not taken. */
export function nextId(taken: readonly string[], prefix: string): string {
  let n = taken.filter((t) => t.startsWith(`${prefix}-`)).length + 1;
  while (taken.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/** Repo paths by the role that owns them; the ones nobody owns (or shared) apart. */
export function groupByOwner(
  plan: SquadPlan,
  paths: readonly string[],
): { byOwner: Map<string, string[]>; unowned: string[] } {
  const byOwner = new Map<string, string[]>();
  const unowned: string[] = [];
  for (const raw of paths) {
    const p = normalizePath(raw);
    if (!p || p.split("/").includes("..")) continue;
    const owner = ownerOf(plan, p);
    if (!owner) {
      if (!unowned.includes(p)) unowned.push(p);
      continue;
    }
    const list = byOwner.get(owner) ?? [];
    if (!list.includes(p)) list.push(p);
    byOwner.set(owner, list);
  }
  return { byOwner, unowned };
}
