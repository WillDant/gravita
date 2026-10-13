import { type GatewayError, KnownErrors, LocalErrors } from "@/infrastructure/engine/GatewayError";
import { t } from "@/shared/i18n/i18n";

/** Why Claude Code can't run sessions right now. */
export type ClaudeProblem = "missing" | "outdated" | "loggedOut";

export interface ErrorView {
  /** One line that names the problem and, where there is one, the way out. */
  text: string;
  /** Set when the fix is in Claude Code itself: show the connect steps. */
  claude?: ClaudeProblem;
}

/** An engine error in the user's words. */
export function describeError(error: GatewayError): ErrorView {
  switch (error.code) {
    case KnownErrors.notControllable:
      return { text: t("error.notControllable") };
    case KnownErrors.claudeUnavailable:
      return { text: t("error.claudeUnavailable"), claude: "missing" };
    case KnownErrors.invalidCwd:
      return { text: t("error.invalidCwd") };
    case KnownErrors.tooManySessions:
      return { text: t("error.tooManySessions") };
    case KnownErrors.notLoggedIn:
      return { text: t("error.notLoggedIn"), claude: "loggedOut" };
    case KnownErrors.squadNotFound:
      return { text: t("error.squadNotFound") };
    case KnownErrors.invalidPlan:
      return { text: t("error.invalidPlan", { message: error.message }) };
    case KnownErrors.squadPhase:
      return { text: t("error.squadPhase", { message: error.message }) };
    case KnownErrors.dirtyWorktree:
      return { text: t("error.dirtyWorktree") };
    case KnownErrors.ghUnavailable:
      return { text: t("error.ghUnavailable") };
    case LocalErrors.offline:
      return { text: t("error.offline") };
    case LocalErrors.timeout:
      return { text: t("error.timeout") };
    default:
      return { text: t("error.generic", { message: error.message }) };
  }
}
