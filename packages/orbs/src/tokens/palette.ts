// Agent colours: every agent type owns one line colour everywhere (registration
// across lenses). `line` draws the transit line, `fill` the orb body, `badge` the
// disc behind the line code (white text passes AA on it, except where `badgeText`).

export interface AgentColor {
  line: string;
  fill: string;
  badge: string;
  badgeText: string;
}

const C = (line: string, fill: string, badge: string, badgeText = "#ffffff"): AgentColor => ({
  line,
  fill,
  badge,
  badgeText,
});

export const POOL: AgentColor[] = [
  C("#e0457b", "#f06c97", "#c2366a"),
  C("#c98a00", "#ffc83d", "#ffc83d", "#3b2a00"),
  C("#12a15f", "#3ccb86", "#0e8048"),
  C("#1c8ad9", "#4fb0f0", "#1570b8"),
  C("#b547d6", "#cc72e6", "#9a36b8"),
];

/**
 * The pool by name, so a squad can give each custom role a hue of its own (allocated in
 * the desktop app, in plan order, skipping hues the plan's built-in roles already use).
 */
export const POOL_KEYS = [
  "role-rose",
  "role-mustard",
  "role-green",
  "role-sky",
  "role-orchid",
] as const;

export const NAMED: Record<string, AgentColor> = {
  main: C("#5b47f0", "#7c6cf7", "#4c3bd9"),
  Explore: C("#0e9f9a", "#2ec4be", "#0b7f7b"),
  Plan: C("#f0552f", "#ff7a59", "#c63d1d"),
  "general-purpose": C("#2f7df6", "#5b9bff", "#1f66d1"),
  // Squad roles (M2) reuse these slots.
  planner: C("#5b47f0", "#7c6cf7", "#4c3bd9"),
  backend: C("#2f7df6", "#5b9bff", "#1f66d1"),
  frontend: C("#f0552f", "#ff7a59", "#c63d1d"),
  design: C("#c98a00", "#ffc83d", "#ffc83d", "#3b2a00"),
  tests: C("#12a15f", "#3ccb86", "#0e8048"),
  ...Object.fromEntries(POOL_KEYS.map((key, i) => [key, POOL[i] as AgentColor])),
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function agentColor(agentType: string): AgentColor {
  return NAMED[agentType] ?? POOL[hash(agentType) % POOL.length]!;
}

/** One or two letters for the line badge, like a metro line code. */
export function lineCode(agentType: string): string {
  if (agentType === "main") return "M";
  if (agentType === "general-purpose") return "G";
  const words = agentType.split(/[-_\s:]+/).filter(Boolean);
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return agentType.slice(0, 1).toUpperCase();
}
