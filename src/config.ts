import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CrewName = "fabricator" | "strategos" | "blackice" | "radio";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  models: Record<CrewName, string>;
  effort: Record<CrewName, Effort>;
  sound: boolean;
  tts: boolean;
  narrator: boolean;
  /** Tools that never ask the Operator. Read-only tools are always allowed. */
  autoApprove: string[];
  /** For API keys not scoped to a workspace. ANTHROPIC_WORKSPACE_ID overrides it. */
  workspaceId?: string;
}

export const DEFAULT_CONFIG: Config = {
  models: {
    fabricator: "claude-opus-5-5",
    strategos: "claude-opus-5-5",
    blackice: "claude-sonnet-5-5",
    radio: "claude-haiku-4-5",
  },
  effort: { fabricator: "high", strategos: "high", blackice: "low", radio: "low" },
  sound: true,
  tts: false,
  narrator: true,
  autoApprove: [],
};

/** Where config and profile live. AMBROSIA_HOME overrides it (used by tests). */
export function ambrosiaHome(): string {
  return process.env.AMBROSIA_HOME ?? path.join(os.homedir(), ".ambrosia");
}

/** Keys from the Greek-themed releases, so an existing config.json keeps its choices. */
const LEGACY_CREW: Record<string, CrewName> = { hephaestus: "fabricator", athena: "strategos", momus: "blackice", hermes: "radio" };

function migrateCrew<T>(byName: Record<string, T> | undefined): Partial<Record<CrewName, T>> {
  const out: Partial<Record<CrewName, T>> = {};
  for (const [name, value] of Object.entries(byName ?? {})) {
    // A current key beats the legacy one it replaced, whichever comes first.
    if (LEGACY_CREW[name]) out[LEGACY_CREW[name]] ??= value;
    else out[name as CrewName] = value;
  }
  return out;
}

export function loadConfig(): Config {
  const file = path.join(ambrosiaHome(), "config.json");
  let user: Partial<Config> = {};
  try {
    user = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // First run: write the defaults so they are easy to discover and edit.
    try {
      fs.mkdirSync(ambrosiaHome(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    } catch {
      // A read-only home is fine; defaults still apply.
    }
  }
  return {
    ...DEFAULT_CONFIG,
    ...user,
    models: { ...DEFAULT_CONFIG.models, ...migrateCrew(user.models) },
    effort: { ...DEFAULT_CONFIG.effort, ...migrateCrew(user.effort) },
  };
}
