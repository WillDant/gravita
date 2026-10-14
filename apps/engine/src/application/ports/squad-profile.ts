import type { AccountPlan, AgentProvider, CodexProfileStatus } from "@gravita/protocol";

// Squad sessions never run on the user's personal setup. For Claude Code the isolation is a
// set of options on each session; Codex reads its whole setup (config, MCP servers, hooks,
// login) from one home, so squads run in a home of Gravita's own that the user signs in to
// once. These ports are what the application asks of that profile.

/** Whether a provider's squad profile is ready to run squad sessions. */
export interface SquadProfiles {
  /** True when sessions of `provider` can run in a squad (Codex: its profile is signed in). */
  signedIn(provider: AgentProvider): Promise<boolean>;
  /**
   * Whether the profile's login has plan limits, when it has a profile of its own (Codex);
   * undefined when the provider's squads run on the user's own login, or it isn't known.
   */
  accountPlan(provider: AgentProvider): AccountPlan | undefined;
}

/** The Codex profile's own controls, for the RPCs behind the Brief's "Sign in" action. */
export interface CodexProfileControl {
  /** Reads the profile's login (a short-lived app-server; nothing spent). */
  status(): Promise<CodexProfileStatus>;
  /**
   * Starts the ChatGPT sign-in: the URL the user opens in their browser. Codex takes the
   * callback and keeps the tokens in the profile; the end arrives as a status update.
   */
  signIn(): Promise<{ authUrl: string }>;
  signOut(): Promise<void>;
}
