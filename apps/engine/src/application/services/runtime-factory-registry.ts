import type { AgentProvider } from "@gravita/protocol";
import { ProviderUnavailableError } from "../../domain/errors";
import type { AgentEnvironment, AgentEnvironmentSource } from "../ports/agent-environment";
import type { ChatRuntimeFactory } from "../ports/chat-runtime";

// The providers this engine can run sessions on, each with the factory of its runtimes and
// the source of its environment. Use cases pick by the provider a request or a squad role
// names, and never know which providers exist.

/** What running sessions on one provider needs. */
export interface ProviderRuntimes {
  factory: ChatRuntimeFactory;
  environment: AgentEnvironmentSource;
}

/** A provider ready to start a session: its factory, and its environment loaded just now. */
export interface ReadyProvider {
  provider: AgentProvider;
  factory: ChatRuntimeFactory;
  environment: AgentEnvironment;
}

export class RuntimeFactoryRegistry {
  private readonly byProvider = new Map<AgentProvider, ProviderRuntimes>();

  constructor(entries: Partial<Record<AgentProvider, ProviderRuntimes>>) {
    for (const [provider, entry] of Object.entries(entries) as [
      AgentProvider,
      ProviderRuntimes | undefined,
    ][])
      if (entry) this.byProvider.set(provider, entry);
  }

  /** The providers sessions can run on. */
  providers(): AgentProvider[] {
    return [...this.byProvider.keys()];
  }

  has(provider: AgentProvider): boolean {
    return this.byProvider.has(provider);
  }

  /**
   * The provider's factory with its environment loaded. Rejects with
   * `ProviderUnavailableError` when the engine has no runtime for it, or its CLI is
   * missing or outdated.
   */
  async ready(provider: AgentProvider): Promise<ReadyProvider> {
    const entry = this.byProvider.get(provider);
    if (!entry) throw new ProviderUnavailableError(provider, "not-found");
    const environment = await entry.environment.load();
    return { provider, factory: entry.factory, environment };
  }
}
