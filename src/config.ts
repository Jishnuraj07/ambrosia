import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type GodName = "hephaestus" | "athena" | "momus" | "hermes";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  models: Record<GodName, string>;
  effort: Record<GodName, Effort>;
  sound: boolean;
  tts: boolean;
  narrator: boolean;
  /** Tools that never ask the Oracle. Read-only tools are always allowed. */
  autoApprove: string[];
  /** For API keys not scoped to a workspace. ANTHROPIC_WORKSPACE_ID overrides it. */
  workspaceId?: string;
}

export const DEFAULT_CONFIG: Config = {
  models: {
    hephaestus: "claude-opus-5-5",
    athena: "claude-opus-5-5",
    momus: "claude-sonnet-5-5",
    hermes: "claude-haiku-4-5",
  },
  effort: { hephaestus: "high", athena: "high", momus: "low", hermes: "low" },
  sound: true,
  tts: false,
  narrator: true,
  autoApprove: [],
};

/** Where config and profile live. AMBROSIA_HOME overrides it (used by tests). */
export function ambrosiaHome(): string {
  return process.env.AMBROSIA_HOME ?? path.join(os.homedir(), ".ambrosia");
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
    models: { ...DEFAULT_CONFIG.models, ...user.models },
    effort: { ...DEFAULT_CONFIG.effort, ...user.effort },
  };
}
