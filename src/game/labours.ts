import type { Labour } from "../events.js";

export const LABOURS = {
  first_blood: { id: "first_blood", title: "First Blood", description: "Fix your first failing test", reward: 25 },
  boss_slayer: { id: "boss_slayer", title: "Monster Slayer", description: "Take a failing suite all the way to green", reward: 40 },
  hydra_slayer: {
    id: "hydra_slayer",
    title: "Hydra Slayer",
    description: "Defeat a monster that grew at least three new heads mid-fight",
    reward: 100,
  },
  sisyphus: { id: "sisyphus", title: "Sisyphus", description: "Watch the same test fail in five separate runs", reward: 15 },
  icarus: { id: "icarus", title: "Icarus", description: "Approve a risky command that then failed", reward: 10 },
  night_owl: { id: "night_owl", title: "Owl of Athena", description: "Work between midnight and 5am", reward: 15 },
  apollo: { id: "apollo", title: "Chariot of Apollo", description: "Work three days in a row", reward: 50 },
  golden_fleece: { id: "golden_fleece", title: "Golden Fleece", description: "Win Momus's approval", reward: 50 },
  pandora: { id: "pandora", title: "Pandora's Restraint", description: "Deny the Oracle three times in one session", reward: 10 },
  odyssey: { id: "odyssey", title: "Odyssey", description: "Complete 10 tasks", reward: 75 },
  argonaut: { id: "argonaut", title: "Argonaut", description: "Run a full council session", reward: 30 },
} satisfies Record<string, Labour>;

export type LabourId = keyof typeof LABOURS;
