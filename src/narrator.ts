import Anthropic from "@anthropic-ai/sdk";
import type { Bus } from "./events.js";
import type { Config } from "./config.js";
import { systemPrompt } from "./agent/personas.js";

const TEMPLATES: Record<string, string[]> = {
  spawn: [
    "A {boss} just booted inside the test suite. {hp} hostile processes.",
    "Heads up, sprawl: a {boss} with {hp} failing tests is jamming the signal.",
  ],
  grow: [
    "Kill one process, two respawn. The {boss} now runs {hp}.",
    "The {boss} is replicating. {hp} failures and climbing.",
  ],
  hit: ["Clean hit! The {boss} is down to {hp}.", "Packet lands. {hp} left on the {boss}."],
  defeated: ["The {boss} is purged! The whole net lights up green.", "Green across the board. The {boss} is deleted."],
  hack: ["New hack unlocked: {title}. The fixers are talking.", "{title}! Somebody spray that on a wall downtown."],
  rank_up: ["New {rank} on the grid. Respect.", "The underground just bumped you to {rank}."],
  denied: ["Operator says no. Paranoid, or smart? In this city, same thing."],
  error: ["Signal dropped. Reboot and run it back."],
  done: ["Fabricator powers down the rig. Job done.", "Job complete. Pirate Radio is putting it on the air."],
};

function pick(kind: string, vars: Record<string, string | number>): string {
  const lines = TEMPLATES[kind] ?? TEMPLATES.done;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return line.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const API_COOLDOWN_MS = 20_000;

/**
 * Pirate Radio watches the bus and comments. Notable moments are batched; a line is
 * written by the cheap narrator model when one was not used recently, and from
 * templates otherwise (or when there is no API access).
 */
export class Narrator {
  enabled = true;
  private log: string[] = [];
  private template: { kind: string; vars: Record<string, string | number> } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastApi = 0;
  private system: string;

  constructor(
    private bus: Bus,
    private client: Anthropic | null,
    private config: Config,
    root: string,
  ) {
    this.system = systemPrompt("radio", root);

    bus.on("edit", (e) => this.note(`edited ${e.path}`));
    bus.on("test_result", (r) => this.note(`ran tests: ${r.failed} failed, ${r.passed} passed`));
    bus.on("shell_result", (r) => r.approved && this.note(`ran \`${r.command.slice(0, 60)}\` (exit ${r.exitCode})`));
    bus.on("boss", ({ boss, change }) => {
      if (!boss || change === "none") return;
      this.note(`threat ${change}: ${boss.name} at ${boss.hp}/${boss.maxHp} hp`);
      this.trigger(change, { boss: boss.name, hp: boss.hp }, change === "spawn" || change === "defeated");
    });
    bus.on("hack", (l) => {
      this.note(`hack completed: ${l.title} (${l.description})`);
      this.trigger("hack", { title: l.title }, true);
    });
    bus.on("rank_up", (r) => {
      this.note(`player promoted to ${r.rank}`);
      this.trigger("rank_up", { rank: r.rank }, true);
    });
    bus.on("approval", (a) => {
      if (a.approved) return;
      this.note(`the user refused to let ${a.crew} run ${a.tool}: ${a.summary.slice(0, 60)}`);
      this.trigger("denied", {}, false);
    });
    bus.on("review", (r) => this.note(`Black ICE ${r.approved ? "approved" : "rejected"} the work`));
    bus.on("error", () => this.trigger("error", {}, false));
    bus.on("turn_end", (t) => {
      if (t.crew !== "fabricator" || t.stopReason !== "end_turn") return;
      this.note("Fabricator finished the job");
      this.trigger("done", {}, true);
    });
  }

  private note(line: string): void {
    this.log.push(line);
    if (this.log.length > 12) this.log.shift();
  }

  /** Schedule a line. `major` moments always get one; minor ones only sometimes. */
  private trigger(kind: string, vars: Record<string, string | number>, major: boolean): void {
    if (!this.enabled) return;
    if (!major && Math.random() < 0.5) return;
    // Keep the most dramatic template if several moments land together.
    if (!this.template || major) this.template = { kind, vars };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 900);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const events = this.log.splice(0);
    const template = this.template;
    this.template = null;
    if (!this.enabled || !template) return;

    let text = "";
    if (this.client && Date.now() - this.lastApi > API_COOLDOWN_MS && events.length) {
      this.lastApi = Date.now();
      text = await this.fromModel(events);
    }
    if (!text) text = pick(template.kind, template.vars);
    this.bus.emit("narration", { text });
  }

  private async fromModel(events: string[]): Promise<string> {
    const model = this.config.models.radio;
    try {
      const r = await this.client!.messages.create({
        model,
        max_tokens: 1024,
        system: this.system,
        ...(model.startsWith("claude-haiku") ? {} : { output_config: { effort: "low" as const } }),
        messages: [{ role: "user", content: `What just happened:\n- ${events.join("\n- ")}` }],
      });
      if (r.stop_reason === "refusal") return "";
      const text = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim()
        .replace(/^["']|["']$/g, "");
      return text.split("\n")[0].slice(0, 200);
    } catch {
      return ""; // fall back to a template
    }
  }
}
