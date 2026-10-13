import type { SquadState } from "@gravita/core";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { squadTitle } from "@/shared/presenters/squad";
import type { SquadView } from "../model";
import { BudgetMeter } from "./BudgetMeter";
import { PhaseTrack } from "./PhaseTrack";
import { SquadControls } from "./SquadControls";

/** Breadcrumb, the squad's line of phases, its budget, and Pause / Stop. */
export function SquadHeader({
  squad,
  view,
  projectName,
}: {
  squad: SquadState;
  view: SquadView;
  projectName: string;
}) {
  const navigate = useNavigate();
  return (
    <header className="flex flex-none flex-nowrap items-center gap-x-5 gap-y-2 border-b border-hairline px-6 py-2.5">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 max-w-[380px] shrink items-center gap-1.5 text-sm"
      >
        <button
          type="button"
          className="flex-none text-ink-2 hover:text-ink"
          onClick={() => navigate({ level: "home" })}
        >
          {t("nav.home")}
        </button>
        <ChevronRight size={14} className="flex-none text-ink-3" aria-hidden="true" />
        <button
          type="button"
          className="max-w-[140px] flex-none truncate text-ink-2 hover:text-ink"
          onClick={() => navigate({ level: "project", projectId: squad.projectId })}
        >
          {projectName}
        </button>
        <ChevronRight size={14} className="flex-none text-ink-3" aria-hidden="true" />
        <span className="truncate font-semibold text-ink" aria-current="page" title={squad.brief}>
          {squadTitle(squad)}
        </span>
      </nav>
      <div className="flex-none max-[1279px]:hidden">
        <PhaseTrack squad={squad} />
      </div>
      <div className="hidden flex-none max-[1279px]:block">
        <PhaseTrack squad={squad} compact />
      </div>
      <div className="ml-auto flex flex-none items-center gap-4">
        {squad.budgetUsd > 0 && <BudgetMeter squad={squad} view={view} />}
        <SquadControls squad={squad} />
      </div>
    </header>
  );
}
