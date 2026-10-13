import type { SquadAutonomy } from "@gravita/protocol";
import { useState } from "react";
import { useNavigate } from "@/app/providers";
import { describeError, type ErrorView } from "@/shared/presenters/errors";
import { useAppStore } from "@/state/hooks";

export type SquadField = "folder" | "goal" | "budget";

/** What a squad may spend unless the user says otherwise. */
export const DEFAULT_BUDGET_USD = 25;
export const MAX_BUDGET_USD = 1_000;
/** Squads plan and build with Opus unless the user picks another model. */
export const DEFAULT_SQUAD_MODEL = "opus";

export interface NewSquadForm {
  folder: string;
  goal: string;
  /** As typed, so "12." can be on its way to "12.5". */
  budget: string;
  autonomy: SquadAutonomy;
  plannerModel: string;
  rolesModel: string;
  setFolder: (v: string) => void;
  setGoal: (v: string) => void;
  setBudget: (v: string) => void;
  setAutonomy: (v: SquadAutonomy) => void;
  setPlannerModel: (v: string) => void;
  setRolesModel: (v: string) => void;
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

export function useNewSquad(defaultFolder = ""): NewSquadForm {
  const createSquad = useAppStore((s) => s.createSquad);
  const navigate = useNavigate();
  const [folder, setFolder] = useState(defaultFolder);
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState(String(DEFAULT_BUDGET_USD));
  const [autonomy, setAutonomy] = useState<SquadAutonomy>("guarded");
  const [plannerModel, setPlannerModel] = useState(DEFAULT_SQUAD_MODEL);
  const [rolesModel, setRolesModel] = useState(DEFAULT_SQUAD_MODEL);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<SquadField>();
  const [error, setError] = useState<ErrorView>();

  const submit = () => {
    if (busy) return;
    const cwd = folder.trim();
    const brief = goal.trim();
    const usd = parseUsd(budget);
    const bad: SquadField | undefined = !cwd
      ? "folder"
      : !brief
        ? "goal"
        : !(usd >= 1 && usd <= MAX_BUDGET_USD)
          ? "budget"
          : undefined;
    setInvalid(bad);
    setError(undefined);
    if (bad) return;
    setBusy(true);
    void createSquad({
      cwd,
      brief,
      budgetUsd: Math.round(usd * 100) / 100,
      autonomy,
      models: { planner: plannerModel, roles: rolesModel },
    }).then((r) => {
      setBusy(false);
      if (r.ok)
        navigate({ level: "squad", projectId: r.value.projectId, squadId: r.value.squadId });
      else setError(describeError(r.error));
    });
  };

  const clear = (field: SquadField) => {
    if (invalid === field) setInvalid(undefined);
  };

  return {
    folder,
    goal,
    budget,
    autonomy,
    plannerModel,
    rolesModel,
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
    setAutonomy,
    setPlannerModel,
    setRolesModel,
    busy,
    invalid,
    error,
    submit,
  };
}
