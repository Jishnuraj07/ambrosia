import fs from "node:fs";
import path from "node:path";
import { ambrosiaHome } from "../config.js";

export interface Profile {
  xp: number;
  labours: Record<string, string>; // id -> ISO date earned
  stats: {
    sessions: number;
    testsFixed: number;
    bossesDefeated: number;
    tasks: number;
    reviewsPassed: number;
    /** Runs in which each test was seen failing, for the Sisyphus labour. */
    failCounts: Record<string, number>;
  };
  days: string[]; // YYYY-MM-DD days with a session, most recent last
}

export function emptyProfile(): Profile {
  return {
    xp: 0,
    labours: {},
    stats: { sessions: 0, testsFixed: 0, bossesDefeated: 0, tasks: 0, reviewsPassed: 0, failCounts: {} },
    days: [],
  };
}

function file(): string {
  return path.join(ambrosiaHome(), "profile.json");
}

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Profile>;
    const base = emptyProfile();
    return { ...base, ...p, stats: { ...base.stats, ...p.stats } };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    fs.mkdirSync(ambrosiaHome(), { recursive: true });
    const tmp = file() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
    fs.renameSync(tmp, file());
  } catch {
    // Losing a save is better than crashing the session.
  }
}

/** Days in a row up to and including the most recent day, counting back. */
export function streak(days: string[]): number {
  if (!days.length) return 0;
  const set = new Set(days);
  let n = 0;
  const d = new Date(days[days.length - 1] + "T12:00:00Z");
  while (set.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

export function localDay(date = new Date()): string {
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 10);
}
