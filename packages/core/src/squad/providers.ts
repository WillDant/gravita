import type { AgentProvider, PlanRole, SquadPlan } from "@gravita/protocol";
import type { SquadProviderChoice } from "@gravita/protocol/constants";

// Who builds a squad. The Brief's choice (`SquadProviders`) puts every role on Claude Code,
// every role on Codex, or lets each role name its own (`mixed`, Claude Code when it names
// none). The briefing and the planner run on Codex only in a Codex-only squad: a mixed squad
// keeps them on Claude Code, which the planner's structured output was built and tested on.
// Shared by the engine (which starts the sessions) and the UI (which shows the marks).

export type { SquadProviderChoice };

/** A squad made before Codex roles is Claude Code only. */
export const DEFAULT_SQUAD_PROVIDERS: SquadProviderChoice = "claude";

/** The provider one role runs on, given the squad's choice. */
export function roleProviderOf(
  choice: SquadProviderChoice | undefined,
  role: Pick<PlanRole, "provider"> | undefined,
): AgentProvider {
  switch (choice ?? DEFAULT_SQUAD_PROVIDERS) {
    case "codex":
      return "codex";
    case "mixed":
      return role?.provider ?? "claude";
    default:
      return "claude";
  }
}

/** The provider of the briefing and the planner: Codex only in a Codex-only squad. */
export function plannerProviderOf(choice: SquadProviderChoice | undefined): AgentProvider {
  return choice === "codex" ? "codex" : "claude";
}

/** The providers a role may run on under the squad's choice. */
export function allowedProviders(choice: SquadProviderChoice | undefined): AgentProvider[] {
  switch (choice ?? DEFAULT_SQUAD_PROVIDERS) {
    case "codex":
      return ["codex"];
    case "mixed":
      return ["claude", "codex"];
    default:
      return ["claude"];
  }
}

/**
 * Every provider a squad's sessions run on: its planner's and each building role's (a plan
 * squad counts each one's plan window).
 */
export function squadProvidersOf(
  choice: SquadProviderChoice | undefined,
  plan?: Pick<SquadPlan, "roles">,
): AgentProvider[] {
  const out = new Set<AgentProvider>([plannerProviderOf(choice)]);
  for (const r of plan?.roles ?? []) if (r.kind !== "planner") out.add(roleProviderOf(choice, r));
  return [...out];
}
