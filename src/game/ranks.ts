export interface Rank {
  name: string;
  min: number;
  glyph: string;
}

export const RANKS: Rank[] = [
  { name: "Script Kiddie", min: 0, glyph: "💾" },
  { name: "Runner", min: 100, glyph: "🕶" },
  { name: "Netrunner", min: 400, glyph: "⌨" },
  { name: "Ghost", min: 1000, glyph: "👻" },
  { name: "Legend", min: 2500, glyph: "🌐" },
];

export function rankFor(xp: number): Rank {
  let r = RANKS[0];
  for (const rank of RANKS) if (xp >= rank.min) r = rank;
  return r;
}

/** Progress towards the next rank, 0..1. 1 at the top rank. */
export function progress(xp: number): { rank: Rank; next: Rank | null; fraction: number } {
  const rank = rankFor(xp);
  const next = RANKS[RANKS.indexOf(rank) + 1] ?? null;
  if (!next) return { rank, next, fraction: 1 };
  return { rank, next, fraction: (xp - rank.min) / (next.min - rank.min) };
}

/** The threat a failing suite spawns, by how many tests fail. */
export const THREATS = [
  { max: 1, name: "Bug" },
  { max: 3, name: "Daemon" },
  { max: 6, name: "Worm" },
  { max: Infinity, name: "Rogue AI" },
];

export function threatFor(hp: number): string {
  return THREATS.find((m) => hp <= m.max)!.name;
}
