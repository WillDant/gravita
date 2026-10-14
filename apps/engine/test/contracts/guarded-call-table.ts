import type { SquadAutonomy } from "@gravita/protocol";
import type { GuardedCall } from "@gravita/protocol/tools";
import type { PermissionVerdict } from "../../src/domain/autonomy-policy";
import type { OwnershipScope } from "../../src/domain/ownership-guard";
import { testPlan } from "../git-helpers";

// What the ownership guard and the autonomy policy decide, stated once in provider-neutral
// calls. Every provider's adapter is checked against this same table: give each case the
// provider's own tool call (see the Claude map in guarded-call.test.ts) and the decisions
// must come out the same.

/** A frontend role's worktree; the plan gives frontend apps/web/ and backend apps/api/. */
export const WT = "/data/worktrees/p1/q1/frontend";

export const SCOPE: OwnershipScope = {
  plan: testPlan(),
  roleId: "frontend",
  roots: [WT, `/private${WT}`],
};

const EDIT = { auto: "allow", guarded: "allow", ask: "ask" } as const;
const LOCAL = EDIT;
const ALWAYS = { auto: "allow", guarded: "allow", ask: "allow" } as const;
const ASK_UNLESS_AUTO = { auto: "allow", guarded: "ask", ask: "ask" } as const;

export interface GuardCase {
  /** What the agent tries to do, in words any provider's call can be mapped from. */
  intent: string;
  /** The neutral call (`tool` aside: it is the provider's own name). */
  call: Omit<GuardedCall, "tool">;
  /** A piece of the guard's refusal, or undefined when the guard lets it through. */
  denied?: string;
  /** The autonomy policy's answer to its permission prompt. */
  permission: Readonly<Record<SquadAutonomy, PermissionVerdict>>;
}

export const GUARD_TABLE: readonly GuardCase[] = [
  {
    intent: "write a file it owns",
    call: { kind: "edit", paths: [`${WT}/apps/web/App.tsx`] },
    permission: EDIT,
  },
  {
    intent: "edit a file another role owns",
    call: { kind: "edit", paths: [`${WT}/apps/api/index.ts`] },
    denied: "backend owns apps/api/",
    permission: EDIT,
  },
  {
    intent: "edit a shared file",
    call: { kind: "edit", paths: ["package.json"] },
    denied: "package.json is shared",
    permission: EDIT,
  },
  {
    intent: "edit a file outside the worktree",
    call: { kind: "edit", paths: ["/etc/hosts"] },
    denied: "outside your worktree",
    permission: EDIT,
  },
  {
    intent: "read a file anywhere",
    call: { kind: "read", paths: ["/etc/hosts"] },
    permission: ALWAYS,
  },
  {
    intent: "run a local command",
    call: { kind: "shell", paths: [], command: "pnpm test" },
    permission: LOCAL,
  },
  {
    intent: "install a package",
    call: { kind: "shell", paths: [], command: "pnpm add zod" },
    permission: ASK_UNLESS_AUTO,
  },
  {
    intent: "commit with git",
    call: { kind: "shell", paths: [], command: "git commit -m x" },
    denied: "git commit changes the repository",
    permission: LOCAL,
  },
  {
    intent: "leave the worktree",
    call: { kind: "shell", paths: [], command: "cd /tmp" },
    denied: "cd /tmp leaves your worktree",
    permission: LOCAL,
  },
  {
    intent: "fetch a web page",
    call: { kind: "web", paths: [] },
    permission: ASK_UNLESS_AUTO,
  },
  {
    intent: "ask the user a question",
    call: { kind: "ask", paths: [] },
    permission: { auto: "ask", guarded: "ask", ask: "ask" },
  },
  {
    intent: "call one of Gravita's role tools",
    call: { kind: "gravita", paths: [] },
    permission: ALWAYS,
  },
  {
    intent: "call another server's tool",
    call: { kind: "other", paths: [] },
    permission: ASK_UNLESS_AUTO,
  },
];
