import Anthropic from "@anthropic-ai/sdk";
import type { Bus } from "./events.js";
import type { Config } from "./config.js";
import { systemPrompt } from "./agent/personas.js";

const TEMPLATES: Record<string, string[]> = {
  spawn: [
    "A {boss} rises from the test suite. {hp} heads, all of them angry.",
    "Look out: a {boss} with {hp} failing tests blocks the road.",
  ],
  grow: [
    "Cut one head, two grow back. The {boss} now has {hp}.",
    "The {boss} grows stronger. {hp} failures and counting.",
  ],
  hit: ["A clean strike! The {boss} is down to {hp}.", "Steel finds its mark. {hp} left on the {boss}."],
  defeated: ["The {boss} falls! The crowd in the amphitheatre goes wild.", "Green across the board. The {boss} is no more."],
  labour: ["A new labour is complete: {title}. Heracles would nod.", "{title}! Someone carve that into marble."],
  rank_up: ["Behold, a {rank} walks among us.", "The gods make room at the table for a new {rank}."],
  denied: ["The Oracle says no. Wisdom, or cowardice? History will decide."],
  error: ["Even the gods stumble. Dust off and try again."],
  done: ["The smith sets down his hammer. Another job done.", "Work complete. Hermes is off to tell everyone."],
};

function pick(kind: string, vars: Record<string, string | number>): string {
  const lines = TEMPLATES[kind] ?? TEMPLATES.done;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return line.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const API_COOLDOWN_MS = 20_000;

/**
 * Hermes watches the bus and comments. Notable moments are batched; a line is
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
    this.system = systemPrompt("hermes", root);

    bus.on("edit", (e) => this.note(`edited ${e.path}`));
    bus.on("test_result", (r) => this.note(`ran tests: ${r.failed} failed, ${r.passed} passed`));
    bus.on("shell_result", (r) => r.approved && this.note(`ran \`${r.command.slice(0, 60)}\` (exit ${r.exitCode})`));
    bus.on("boss", ({ boss, change }) => {
      if (!boss || change === "none") return;
      this.note(`monster ${change}: ${boss.name} at ${boss.hp}/${boss.maxHp} hp`);
      this.trigger(change, { boss: boss.name, hp: boss.hp }, change === "spawn" || change === "defeated");
    });
    bus.on("labour", (l) => {
      this.note(`labour completed: ${l.title} (${l.description})`);
      this.trigger("labour", { title: l.title }, true);
    });
    bus.on("rank_up", (r) => {
      this.note(`player promoted to ${r.rank}`);
      this.trigger("rank_up", { rank: r.rank }, true);
    });
    bus.on("approval", (a) => {
      if (a.approved) return;
      this.note(`the user refused to let ${a.god} run ${a.tool}: ${a.summary.slice(0, 60)}`);
      this.trigger("denied", {}, false);
    });
    bus.on("review", (r) => this.note(`Momus ${r.approved ? "approved" : "rejected"} the work`));
    bus.on("error", () => this.trigger("error", {}, false));
    bus.on("turn_end", (t) => {
      if (t.god !== "hephaestus" || t.stopReason !== "end_turn") return;
      this.note("Hephaestus finished the task");
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
    const model = this.config.models.hermes;
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
