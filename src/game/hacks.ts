import type { Hack } from "../events.js";

export const HACKS = {
  first_blood: { id: "first_blood", title: "First Blood", description: "Fix your first failing test", reward: 25 },
  daemon_killer: { id: "daemon_killer", title: "Daemon Killer", description: "Take a failing suite all the way to green", reward: 40 },
  fork_bomb: {
    id: "fork_bomb",
    title: "Fork Bomb Survivor",
    description: "Purge a threat that spawned at least three new failures mid-fight",
    reward: 100,
  },
  infinite_loop: { id: "infinite_loop", title: "Infinite Loop", description: "Watch the same test fail in five separate runs", reward: 15 },
  bricked: { id: "bricked", title: "Bricked", description: "Approve a risky command that then failed", reward: 10 },
  night_shift: { id: "night_shift", title: "Night Shift", description: "Work between midnight and 5am", reward: 15 },
  uptime: { id: "uptime", title: "Uptime", description: "Work three days in a row", reward: 50 },
  cracked_ice: { id: "cracked_ice", title: "Cracked the ICE", description: "Win Black ICE's approval", reward: 50 },
  firewall: { id: "firewall", title: "Firewall", description: "Block three actions in one session", reward: 10 },
  gig_economy: { id: "gig_economy", title: "Gig Economy", description: "Complete 10 jobs", reward: 75 },
  full_crew: { id: "full_crew", title: "Full Crew", description: "Pull off a full heist", reward: 30 },
} satisfies Record<string, Hack>;

export type HackId = keyof typeof HACKS;

/** Ids from the Greek-themed releases, so old profiles keep what they earned. */
export const LEGACY_HACK_IDS: Record<string, HackId> = {
  boss_slayer: "daemon_killer",
  hydra_slayer: "fork_bomb",
  sisyphus: "infinite_loop",
  icarus: "bricked",
  night_owl: "night_shift",
  apollo: "uptime",
  golden_fleece: "cracked_ice",
  pandora: "firewall",
  odyssey: "gig_economy",
  argonaut: "full_crew",
};
