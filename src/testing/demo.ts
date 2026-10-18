import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import type { GodName } from "../config.js";

type ScriptedMessage = { stop_reason: string; content: Array<Record<string, unknown>> };

/**
 * The demo session used by the smoke tests: Hephaestus finds a failing test in
 * math.mjs, fixes `add`, and reruns; Momus approves. No API key needed.
 */
export function demoScripts(testCommand = "node --test"): Partial<Record<GodName, ScriptedMessage[]>> {
  return {
    hephaestus: [
      { stop_reason: "tool_use", content: [{ type: "text", text: "Let's see what's cracked." }, { type: "tool_use", id: "h1", name: "run_tests", input: { command: testCommand } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h2", name: "read_file", input: { path: "math.mjs" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h3", name: "edit_file", input: { path: "math.mjs", old_string: "a - b", new_string: "a + b" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h4", name: "run_tests", input: { command: testCommand } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Fixed: `add` subtracted instead of adding. All **3 tests** pass. Good metal now." }] },
    ],
    momus: [
      { stop_reason: "end_turn", content: [{ type: "text", text: "A one-character fix. Truly, the bards will sing of it.\n\nNo real findings.\n\nVERDICT: APPROVED" }] },
    ],
  };
}

/** Which god a request is for, from the persona line that opens its system prompt. */
function godOf(system: unknown): GodName | null {
  const text = typeof system === "string" ? system : "";
  const m = text.match(/^You are (Hephaestus|Athena|Momus|Hermes)/);
  return m ? (m[1].toLowerCase() as GodName) : null;
}

/**
 * A stand-in for the SDK client that replays scripted replies per god. Only the
 * calls Ambrosia makes are implemented: beta streaming for the gods and
 * messages.create for the narrator.
 */
export function createScriptedClient(scripts: Partial<Record<GodName, ScriptedMessage[]>>, delayMs = 150): Anthropic {
  const fallback = (god: GodName | null): ScriptedMessage => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: `(${god ?? "unknown"} has no more scripted lines)` }],
  });
  const client = {
    beta: {
      messages: {
        stream(params: { system?: unknown }) {
          const god = godOf(params.system);
          const msg = (god && scripts[god]?.shift()) || fallback(god);
          const on: Record<string, (d: string) => void> = {};
          return {
            on(name: string, fn: (d: string) => void) {
              on[name] = fn;
              return this;
            },
            async finalMessage() {
              await new Promise((r) => setTimeout(r, delayMs));
              on.thinking?.("Weighing where the crack in the casting is…");
              for (const b of msg.content) if (b.type === "text") on.text?.(String(b.text));
              return { usage: { input_tokens: 1, output_tokens: 1 }, stop_details: null, ...msg };
            },
          };
        },
      },
    },
    messages: {
      async create() {
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Hermes saw it all, and he's telling everyone." }] };
      },
    },
  };
  return client as unknown as Anthropic;
}

/** A tiny project with one bug (`add` subtracts) and three tests, two of them failing. */
export function createDemoProject(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "math.mjs"), "export const add = (a, b) => a - b;\n");
  fs.writeFileSync(
    path.join(dir, "math.test.mjs"),
    `import test from "node:test";
import assert from "node:assert";
import { add } from "./math.mjs";
test("adds", () => assert.equal(add(2, 2), 4));
test("adds negatives", () => assert.equal(add(-1, -1), -2));
test("adds zero", () => assert.equal(add(0, 0), 0));
`,
  );
  execSync("git init -q && git add . && git -c user.email=demo@ambrosia -c user.name=demo commit -qm init", {
    cwd: dir,
    stdio: "ignore",
  });
}
