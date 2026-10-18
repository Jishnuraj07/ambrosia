export interface Rank {
  name: string;
  min: number;
  glyph: string;
}

export const RANKS: Rank[] = [
  { name: "Mortal", min: 0, glyph: "🏺" },
  { name: "Hero", min: 100, glyph: "🛡" },
  { name: "Demigod", min: 400, glyph: "⚡" },
  { name: "Titan", min: 1000, glyph: "⛰" },
  { name: "Olympian", min: 2500, glyph: "🏛" },
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

export const MONSTERS = [
  { max: 1, name: "Harpy" },
  { max: 3, name: "Minotaur" },
  { max: 6, name: "Chimera" },
  { max: Infinity, name: "Hydra" },
];

export function monsterFor(hp: number): string {
  return MONSTERS.find((m) => hp <= m.max)!.name;
}
