import { useId } from "react";
import { cn } from "@/shared/utils";

/**
 * The large, coloured counterpart of `ProviderIcon`, for a moment that belongs to the agent
 * (a new chat's welcome). Drawn for Gravita, not the vendors' logos. Claude Code keeps its
 * warm spark, Codex a blue-violet tile; Cursor stays black and white, in the ink and ground
 * colours so it reads on both themes.
 */
export function ProviderLogo({
  provider,
  size = 56,
  className,
}: {
  provider: string;
  size?: number;
  className?: string;
}) {
  const gradient = useId();
  const mark = MARKS[provider];
  if (!mark) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      {mark(gradient)}
    </svg>
  );
}

const CLAUDE = "#d97757";
const INK = "var(--ink)";
const GROUND = "var(--ground)";

const MARKS: Readonly<Record<string, (gradient: string) => React.ReactNode>> = {
  claude: () => (
    <path
      d="M24 6v36M6 24h36M11.3 11.3l25.4 25.4M36.7 11.3 11.3 36.7"
      stroke={CLAUDE}
      strokeWidth="4.5"
      strokeLinecap="round"
    />
  ),
  codex: (gradient) => (
    <>
      <defs>
        <linearGradient id={gradient} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7aa2ff" />
          <stop offset="1" stopColor="#5b3df5" />
        </linearGradient>
      </defs>
      <rect x="5" y="8" width="38" height="32" rx="10" fill={`url(#${gradient})`} />
      <path
        d="m16 19 7 5-7 5M26 30h6.5"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  cursor: () => (
    <>
      <path d="m24 5 17 9.8v18.4L24 43 7 33.2V14.8z" fill={INK} />
      <path
        d="m24 24 17-9.2M24 24v19M24 24 7 14.8"
        stroke={GROUND}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
};
