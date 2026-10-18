import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Bus } from "./events.js";
import { loadConfig, type Config } from "./config.js";
import { Agent, describeError } from "./agent/loop.js";
import { READ_ONLY_TOOLS, type ApprovalRequest } from "./agent/tools.js";
import { runCouncil, runRoast, type Pantheon } from "./agent/council.js";
import { GameEngine } from "./game/engine.js";
import { loadProfile } from "./game/profile.js";
import { LABOURS } from "./game/labours.js";
import { progress } from "./game/ranks.js";
import { streak } from "./game/profile.js";
import { Narrator } from "./narrator.js";
import { play } from "./audio/earcons.js";
import { speak, stopSpeaking } from "./audio/tts.js";

export type ApprovalAnswer = "yes" | "always" | "no";

export interface SessionOptions {
  root: string;
  serious?: boolean;
  mute?: boolean;
  yolo?: boolean;
}

/** Everything behind the UI: the pantheon, the game, the narrator and the sound. */
export class Session {
  readonly bus = new Bus();
  readonly config: Config;
  readonly engine: GameEngine;
  readonly root: string;
  serious: boolean;
  sound: boolean;
  tts: boolean;
  busy = false;

  private client: Anthropic | null = null;
  private pantheon: Pantheon | null = null;
  private narrator: Narrator;
  private abort: AbortController | null = null;
  private alwaysAllow = new Set<string>();
  private yolo: boolean;
  private askUser: ((req: ApprovalRequest) => Promise<ApprovalAnswer>) | null = null;
  private approvalChain: Promise<unknown> = Promise.resolve();

  constructor(opts: SessionOptions) {
    this.root = opts.root;
    this.config = loadConfig();
    this.serious = !!opts.serious;
    this.sound = this.config.sound && !opts.mute;
    this.tts = this.config.tts && !opts.mute;
    this.yolo = !!opts.yolo;
    for (const t of [...READ_ONLY_TOOLS, ...this.config.autoApprove]) this.alwaysAllow.add(t);

    try {
      this.client = new Anthropic();
    } catch (err) {
      this.client = null;
      queueMicrotask(() => this.bus.emit("error", { message: describeError(err) }));
    }

    if (this.client) {
      const approve = (req: ApprovalRequest) => this.approve(req);
      const make = (god: "hephaestus" | "athena" | "momus", tools?: string[]) =>
        new Agent({ god, client: this.client!, config: this.config, root: this.root, bus: this.bus, approve, tools });
      this.pantheon = {
        hephaestus: make("hephaestus"),
        athena: make("athena", READ_ONLY_TOOLS),
        momus: make("momus", READ_ONLY_TOOLS),
      };
    }

    this.engine = new GameEngine(this.bus, loadProfile());
    this.narrator = new Narrator(this.bus, this.client, this.config, this.root);
    this.applyMode();
    this.wireSound();
    this.engine.startSession();
    if (this.sound && !this.serious) play("start");
    if (!hasCredentials()) {
      queueMicrotask(() =>
        this.bus.emit("notice", {
          text: "⚠ No Anthropic credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) before giving the gods a task.",
        }),
      );
    }
  }

  /** The UI registers how to ask the user. Requests are queued so prompts never overlap. */
  setApprovalHandler(fn: (req: ApprovalRequest) => Promise<ApprovalAnswer>): void {
    this.askUser = fn;
  }

  private approve(req: ApprovalRequest): Promise<boolean> {
    if (this.yolo || this.alwaysAllow.has(req.tool)) return Promise.resolve(true);
    const next = this.approvalChain.then(async () => {
      // An earlier "always" in the queue may have covered this one.
      if (this.alwaysAllow.has(req.tool)) return true;
      if (!this.askUser) return false;
      if (this.sound) play("oracle");
      const answer = await this.askUser(req);
      if (answer === "always") this.alwaysAllow.add(req.tool);
      return answer !== "no";
    });
    this.approvalChain = next.catch(() => {});
    return next;
  }

  private applyMode(): void {
    this.engine.enabled = !this.serious;
    this.narrator.enabled = !this.serious && this.config.narrator;
  }

  private wireSound(): void {
    const sfx = (fn: () => void) => () => {
      if (this.sound && !this.serious) fn();
    };
    const b = this.bus;
    b.on("boss", ({ change }) =>
      sfx(() => {
        if (change === "spawn") play("fail");
        else if (change === "grow") play("grow");
        else if (change === "hit") play("hit");
        else if (change === "defeated") play("success");
      })(),
    );
    b.on("labour", sfx(() => play("labour")));
    b.on("rank_up", sfx(() => play("rankup")));
    b.on("error", sfx(() => play("fail")));
    b.on("turn_end", (t) => {
      if (t.god === "hephaestus" && t.stopReason === "end_turn") sfx(() => play("done"))();
    });
    b.on("narration", (n) => {
      if (this.tts && !this.serious) speak(n.text);
    });
  }

  /** Esc: stop whatever the gods are doing. */
  interrupt(): void {
    this.abort?.abort();
    stopSpeaking();
  }

  private async task(fn: (p: Pantheon, signal: AbortSignal) => Promise<unknown>): Promise<void> {
    if (!this.pantheon) {
      this.bus.emit("error", {
        message: "No connection to Olympus. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart.",
      });
      return;
    }
    this.busy = true;
    this.abort = new AbortController();
    try {
      await fn(this.pantheon, this.abort.signal);
    } catch (err) {
      if (!this.abort.signal.aborted) this.bus.emit("error", { message: describeError(err) });
    } finally {
      if (this.abort.signal.aborted) this.bus.emit("notice", { text: "Interrupted." });
      this.abort = null;
      this.busy = false;
    }
  }

  /** Handle one line of input: a slash command or a task for Hephaestus. */
  async submit(line: string): Promise<"quit" | void> {
    const text = line.trim();
    if (!text) return;
    if (!text.startsWith("/")) return this.task((p, s) => p.hephaestus.run(text, s));

    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    const say = (t: string) => this.bus.emit("notice", { text: t });
    switch (cmd) {
      case "/quit":
      case "/exit":
        return "quit";
      case "/help":
        say(HELP);
        return;
      case "/council":
        if (!arg) return say("Usage: /council <task>");
        return this.task(async (p, s) => {
          await runCouncil(p, this.bus, this.root, arg, s);
          if (!s.aborted) this.engine.award("argonaut");
        });
      case "/roast":
        return this.task((p, s) => runRoast(p, this.bus, this.root, s));
      case "/stats":
        say(this.stats());
        return;
      case "/labours":
        say(this.labours());
        return;
      case "/mute":
        this.sound = !this.sound;
        if (!this.sound) {
          this.tts = false;
          stopSpeaking();
        }
        say(this.sound ? "The lyre plays again." : "Silence falls over Olympus.");
        return;
      case "/tts":
        this.tts = !this.tts;
        if (!this.tts) stopSpeaking();
        say(this.tts ? "Hermes will speak his commentary aloud." : "Hermes keeps his voice down.");
        return;
      case "/serious":
        this.serious = !this.serious;
        this.applyMode();
        say(this.serious ? "Serious mode: no narration, sound or ambrosia. Just the work." : "The festival resumes.");
        return;
      case "/clear":
        if (this.pantheon) Object.values(this.pantheon).forEach((a) => a.reset());
        say("The gods forget everything said so far.");
        return;
      default:
        say(`Unknown command ${cmd}. Try /help.`);
    }
  }

  private stats(): string {
    const p = this.engine.profile;
    const { rank, next } = progress(p.xp);
    const earned = Object.keys(p.labours).length;
    return [
      `${rank.glyph} ${rank.name} · ${p.xp} ambrosia${next ? ` (${next.min - p.xp} to ${next.name})` : ""}`,
      `Labours: ${earned}/${Object.keys(LABOURS).length} · Sessions: ${p.stats.sessions} · Day streak: ${streak(p.days)}`,
      `Tests fixed: ${p.stats.testsFixed} · Monsters slain: ${p.stats.bossesDefeated} · Tasks: ${p.stats.tasks} · Momus approvals: ${p.stats.reviewsPassed}`,
    ].join("\n");
  }

  private labours(): string {
    const earned = this.engine.profile.labours;
    return Object.values(LABOURS)
      .map((l) => `${earned[l.id] ? "✦" : "·"} ${l.title.padEnd(20)} ${l.description}  (+${l.reward})`)
      .join("\n");
  }
}

/** A best guess, for a friendly warning only: the SDK itself has the final say. */
function hasCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) return true;
  if (process.env.ANTHROPIC_FEDERATION_RULE_ID) return true;
  const configDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return fs.existsSync(path.join(configDir, "anthropic"));
}

const HELP = `Talk to Hephaestus by typing a task. Commands:
  /council <task>  Athena plans, Hephaestus builds, Momus reviews
  /roast           Momus reviews your uncommitted changes
  /stats           your rank, ambrosia and record
  /labours         achievements earned and still to earn
  /mute            toggle sound      /tts      toggle spoken narration
  /serious         toggle the fun    /clear    forget the conversation
  /quit            leave Olympus
Esc interrupts the gods mid-work.`;
