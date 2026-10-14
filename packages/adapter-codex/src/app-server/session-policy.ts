import type { CodexMode } from "@gravita/protocol";
import type { AskForApproval, SandboxMode, SandboxPolicy } from "./protocol";

// Gravita's Codex modes in Codex's own terms: when it asks (approval policy) and what it
// may touch without asking (sandbox). They follow Codex's own presets, so a mode means in
// Gravita what it means in Codex:
//
//   ask         "Ask before acting"   read-only sandbox, asks on request: it reads freely;
//                                     any edit, write or network use waits for the user.
//   workspace   "Edit in this folder" the folder is writable, no network; it asks to go
//                                     beyond either.
//   fullAccess  "Full access"         no sandbox, never asks. Only when a session starts.
//   dontAsk     (Gravita's own, for planning sessions) read-only and never asks: whatever
//               needs more is refused.

export type CodexSessionMode = CodexMode | "dontAsk";

/** One mode as thread/start takes it (sandbox by name) and turn/start (sandbox by policy). */
export interface CodexSessionPolicy {
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
  sandboxPolicy: SandboxPolicy;
}

export function codexSessionPolicy(mode: CodexSessionMode, cwd: string): CodexSessionPolicy {
  switch (mode) {
    case "ask":
      return {
        approvalPolicy: "on-request",
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      };
    case "workspace":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [cwd],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      };
    case "fullAccess":
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
    case "dontAsk":
      return {
        approvalPolicy: "never",
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      };
  }
}
