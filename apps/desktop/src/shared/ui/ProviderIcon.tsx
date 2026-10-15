import type { AgentProvider } from "@gravita/protocol/constants";
import { cn } from "@/shared/utils";

/**
 * A small mark for each agent, drawn for Gravita (not the vendors' logos): a spark for Claude
 * Code, a prompt for Codex, a cube for Cursor. Monochrome, in the colour of the text around it.
 */
const GLYPHS: Readonly<Record<AgentProvider, React.ReactNode>> = {
  claude: <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />,
  codex: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="4.5" />
      <path d="m8.5 10 3 2-3 2M13.5 15h2.5" />
    </>
  ),
  cursor: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m12 12 8-4.5M12 12v9M12 12 4 7.5" />
    </>
  ),
};

export function ProviderIcon({
  provider,
  size = 15,
  className,
}: {
  provider: string;
  size?: number;
  className?: string;
}) {
  const glyph = GLYPHS[provider as AgentProvider];
  if (!glyph) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      {glyph}
    </svg>
  );
}
