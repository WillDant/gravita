import type { AgentProvider } from "@gravita/protocol/constants";
import { SquareTerminal } from "lucide-react";
import { ProviderLogo } from "./ProviderLogo";

/** The agent's coloured logo when one runs in the terminal, else the plain terminal icon. */
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
    <ProviderLogo provider={provider} size={size} {...(className ? { className } : {})} />
  ) : (
    <SquareTerminal size={size} aria-hidden="true" {...(className ? { className } : {})} />
  );
}
