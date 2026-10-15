import type { AgentProvider } from "@gravita/protocol/constants";
import { SquareTerminal } from "lucide-react";
import { ProviderIcon } from "./ProviderIcon";

/** The agent's mark when one runs in the terminal, else the plain terminal icon. */
export function TerminalIcon({
  provider,
  size = 15,
  className,
}: {
  provider: AgentProvider | undefined;
  size?: number;
  className?: string;
}) {
  return provider ? (
    <ProviderIcon provider={provider} size={size} {...(className ? { className } : {})} />
  ) : (
    <SquareTerminal size={size} aria-hidden="true" {...(className ? { className } : {})} />
  );
}
