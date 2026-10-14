import { MODEL_CHOICES, type ModelChoice } from "@gravita/core";
import type { PlanWindow, SquadAutonomy, SquadBudget } from "@gravita/protocol";
import { RpcErrors, type SquadProviderChoice } from "@gravita/protocol/constants";
import { useState } from "react";
import { useNavigate } from "@/app/providers";
import { describeError, type ErrorView } from "@/shared/presenters/errors";
import { useAccountPlan, useAppStore, useCanStartWith, useCodexProfile } from "@/state/hooks";

export type SquadField = "folder" | "goal" | "providers" | "budget" | "share";

/**
 * How the budget is stated: a share of a plan window (subscriptions, the usual case), or
 * dollars for an account that pays per token (an API key).
 */
export type BudgetMode = "plan" | "usd";

/** The share of the plan a squad may use unless the user says otherwise. */
export const DEFAULT_SHARE_PERCENT = 20;
export const DEFAULT_PLAN_WINDOW: PlanWindow = "seven_day";

/** What a squad may spend unless the user says otherwise. */
export const DEFAULT_BUDGET_USD = 25;
export const MAX_BUDGET_USD = 1_000;
/** Squads run the Automatic (cost-benefit) model policy unless the user picks otherwise. */
export const DEFAULT_MODEL_CHOICE: ModelChoice = "auto";

export interface NewSquadForm {
  folder: string;
  goal: string;
  /** Plan share or dollars: dollars only for an account without plan limits. */
  budgetMode: BudgetMode;
  /** As typed, so "12." can be on its way to "12.5". */
  budget: string;
  /** The plan share in percent, as typed. */
  share: string;
  window: PlanWindow;
  autonomy: SquadAutonomy;
  models: ModelChoice;
  /** Who builds it; offered only when Codex can run here. */
  providers: SquadProviderChoice;
  /** Whether the choice of who builds it is offered at all (Codex is installed). */
  canChooseProviders: boolean;
  /** Codex roles need Gravita's Codex profile signed in. */
  needsCodexProfile: boolean;
  setFolder: (v: string) => void;
  setGoal: (v: string) => void;
  setBudget: (v: string) => void;
  setShare: (v: string) => void;
  setWindow: (v: PlanWindow) => void;
  setAutonomy: (v: SquadAutonomy) => void;
  setModels: (v: ModelChoice) => void;
  setProviders: (v: SquadProviderChoice) => void;
  busy: boolean;
  /** The first field that stopped the last attempt. */
  invalid?: SquadField;
  error?: ErrorView;
  submit: () => void;
}

/** "$25", "25", "1,000.50" → a number of dollars; NaN when it isn't one. */
export function parseUsd(text: string): number {
  const clean = text.replace(/[$\s,]/g, "");
  return clean && /^\d*\.?\d*$/.test(clean) ? Number(clean) : Number.NaN;
}

/** "20", "20%", "12.5" → a number of percent; NaN when it isn't one. */
export function parsePercent(text: string): number {
  const clean = text.replace(/[%\s]/g, "").replace(",", ".");
  return clean && /^\d*\.?\d*$/.test(clean) ? Number(clean) : Number.NaN;
}

export function useNewSquad(defaultFolder = ""): NewSquadForm {
  const createSquad = useAppStore((s) => s.createSquad);
  const plan = useAccountPlan("claude");
  const canChooseProviders = useCanStartWith("codex");
  const [chosen, setProviders] = useState<SquadProviderChoice>("claude");
  const providers: SquadProviderChoice = canChooseProviders ? chosen : "claude";
  const needsCodexProfile = providers !== "claude";
  const profile = useCodexProfile();
  // The engine refused a plan share (an API-key account it hadn't seen yet): dollars.
  const [refusedPlan, setRefusedPlan] = useState(false);
  // Codex roles are measured in plan usage only (Codex reports no dollars).
  const budgetMode: BudgetMode =
    !needsCodexProfile && (plan === "api" || refusedPlan) ? "usd" : "plan";
  const [share, setShare] = useState(String(DEFAULT_SHARE_PERCENT));
  const [planWindow, setWindow] = useState<PlanWindow>(DEFAULT_PLAN_WINDOW);
  const navigate = useNavigate();
  const [folder, setFolder] = useState(defaultFolder);
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState(String(DEFAULT_BUDGET_USD));
  const [autonomy, setAutonomy] = useState<SquadAutonomy>("guarded");
  const [models, setModels] = useState<ModelChoice>(DEFAULT_MODEL_CHOICE);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<SquadField>();
  const [error, setError] = useState<ErrorView>();

  const submit = () => {
    if (busy) return;
    const cwd = folder.trim();
    const brief = goal.trim();
    const usd = parseUsd(budget);
    const percent = parsePercent(share);
    const bad: SquadField | undefined = !cwd
      ? "folder"
      : !brief
        ? "goal"
        : needsCodexProfile && !profile?.loggedIn
          ? "providers"
          : budgetMode === "usd" && !(usd >= 1 && usd <= MAX_BUDGET_USD)
            ? "budget"
            : budgetMode === "plan" && !(percent >= 1 && percent <= 100)
              ? "share"
              : undefined;
    setInvalid(bad);
    setError(undefined);
    if (bad) return;
    setBusy(true);
    void createSquad({
      cwd,
      brief,
      budget: budgetOf(),
      autonomy,
      models: { ...MODEL_CHOICES[models] },
      ...(providers !== "claude" ? { providers } : {}),
    }).then((r) => {
      setBusy(false);
      if (r.ok)
        navigate({ level: "squad", projectId: r.value.projectId, squadId: r.value.squadId });
      else {
        if (r.error.code === RpcErrors.planUsageUnavailable.code && !needsCodexProfile)
          setRefusedPlan(true);
        if (r.error.code === RpcErrors.codexProfileSignedOut.code) setInvalid("providers");
        setError(describeError(r.error));
      }
    });
  };

  function budgetOf(): SquadBudget {
    return budgetMode === "plan"
      ? { mode: "plan", maxPercent: Math.round(parsePercent(share) * 10) / 10, window: planWindow }
      : { mode: "usd", amount: Math.round(parseUsd(budget) * 100) / 100 };
  }

  const clear = (field: SquadField) => {
    if (invalid === field) setInvalid(undefined);
  };

  return {
    folder,
    goal,
    budgetMode,
    budget,
    share,
    window: planWindow,
    autonomy,
    models,
    providers,
    canChooseProviders,
    needsCodexProfile,
    setFolder: (v) => {
      setFolder(v);
      clear("folder");
    },
    setGoal: (v) => {
      setGoal(v);
      clear("goal");
    },
    setBudget: (v) => {
      setBudget(v);
      clear("budget");
    },
    setShare: (v) => {
      setShare(v);
      clear("share");
    },
    setWindow,
    setAutonomy,
    setModels,
    setProviders: (v) => {
      setProviders(v);
      clear("providers");
    },
    busy,
    invalid,
    error,
    submit,
  };
}
