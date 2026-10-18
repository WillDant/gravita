import type { AgentProvider } from "@gravita/protocol/constants";
import { type GatewayError, KnownErrors, LocalErrors } from "@/infrastructure/engine/GatewayError";
import { t } from "@/shared/i18n/i18n";

/**
 * Why a provider's agent can't run sessions right now. Cursor never logs in: it runs only
 * with the API key set in Gravita, so it has key problems instead of `loggedOut`.
 */
export type ProviderProblem = "missing" | "outdated" | "loggedOut" | "keyMissing" | "keyInvalid";

/** A problem the user fixes in a provider's own CLI (or Cursor's key): the connect steps. */
export interface ConnectIssue {
  provider: AgentProvider;
  problem: ProviderProblem;
}

export interface ErrorView {
  /** One line that names the problem and, where there is one, the way out. */
  text: string;
  /** Set when the fix is in the provider's CLI itself: show its connect steps. */
  connect?: ConnectIssue;
}

/** The copy of a provider error, in that provider's name. */
const PROVIDER_COPY: Readonly<Record<AgentProvider, { unavailable: string; notLoggedIn: string }>> =
  {
    claude: { unavailable: "error.claudeUnavailable", notLoggedIn: "error.notLoggedIn" },
    codex: { unavailable: "error.codexUnavailable", notLoggedIn: "error.codexNotLoggedIn" },
    cursor: { unavailable: "error.cursorUnavailable", notLoggedIn: "error.cursorNoKey" },
  };

/** An engine error in the user's words. */
export function describeError(error: GatewayError): ErrorView {
  switch (error.code) {
    case KnownErrors.notControllable:
      return { text: t("error.notControllable") };
    case KnownErrors.providerUnavailable: {
      const provider = error.provider;
      return {
        text: t(PROVIDER_COPY[provider].unavailable),
        connect: { provider, problem: "missing" },
      };
    }
    case KnownErrors.invalidCwd:
      return { text: t("error.invalidCwd") };
    case KnownErrors.tooManySessions:
      return { text: t("error.tooManySessions") };
    case KnownErrors.notLoggedIn: {
      const provider = error.provider;
      // Cursor's key panel tells a missing key from a rejected one by the live status.
      return {
        text: t(PROVIDER_COPY[provider].notLoggedIn),
        connect: { provider, problem: provider === "cursor" ? "keyMissing" : "loggedOut" },
      };
    }
    case KnownErrors.squadNotFound:
      return { text: t("error.squadNotFound") };
    case KnownErrors.planUsageUnavailable:
      return { text: t("error.planUsageUnavailable") };
    case KnownErrors.invalidPlan:
      return { text: t("error.invalidPlan", { message: error.message }) };
    case KnownErrors.squadPhase:
      return { text: t("error.squadPhase", { message: error.message }) };
    case KnownErrors.dirtyWorktree:
      return { text: t("error.dirtyWorktree") };
    case KnownErrors.ghUnavailable:
      return { text: t("error.ghUnavailable") };
    case KnownErrors.codexProfileSignedOut:
      // The engine's words say which: the profile isn't signed in, or a dollar budget.
      return { text: error.message };
    case KnownErrors.terminalUnsupported:
      return { text: t("error.terminalUnsupported") };
    case KnownErrors.tooManyTerminals:
      return { text: t("error.tooManyTerminals") };
    case KnownErrors.terminalNotFound:
      return { text: t("error.terminalNotFound") };
    case KnownErrors.pathOutsideRoot:
      return { text: t("error.pathOutsideRoot") };
    case KnownErrors.fileConflict:
      return { text: t("error.fileConflict") };
    case KnownErrors.fileNotFound:
      return { text: t("error.fileNotFound") };
    case LocalErrors.offline:
      return { text: t("error.offline") };
    case LocalErrors.timeout:
      return { text: t("error.timeout") };
    default:
      return { text: t("error.generic", { message: error.message }) };
  }
}
