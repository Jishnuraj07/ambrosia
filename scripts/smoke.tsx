/**
 * End-to-end smoke test: renders the real UI against a scratch project.
 * Hephaestus finds a failing test, fixes the bug and reruns; then Momus roasts
 * the diff. By default the models are scripted stand-ins, so no API key is
 * needed. With --live it uses the real models (and costs a little).
 *
 *   npm run smoke
 *   npm run smoke -- --live
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import React from "react";
import { render } from "ink";

const live = process.argv.includes("--live");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ambrosia-smoke-"));
process.env.AMBROSIA_HOME = path.join(scratch, ".home");
const project = path.join(scratch, "project");
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, "math.mjs"), "export const add = (a, b) => a - b;\n");
fs.writeFileSync(
  path.join(project, "math.test.mjs"),
  `import test from "node:test";
import assert from "node:assert";
import { add } from "./math.mjs";
test("adds", () => assert.equal(add(2, 2), 4));
test("adds negatives", () => assert.equal(add(-1, -1), -2));
test("adds zero", () => assert.equal(add(0, 0), 0));
`,
);
execSync('git init -q && git add . && git -c user.email=a@b -c user.name=smoke commit -qm init', { cwd: project });

const { Session } = await import("../src/session.js");
const { Agent } = await import("../src/agent/loop.js");
const { App } = await import("../src/ui/App.js");
const { READ_ONLY_TOOLS } = await import("../src/agent/tools.js");

const scripts: Record<string, any[]> = {
  hephaestus: [
    { stop_reason: "tool_use", content: [{ type: "text", text: "Let's see what's cracked." }, { type: "tool_use", id: "h1", name: "run_tests", input: { command: "node --test" } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h2", name: "read_file", input: { path: "math.mjs" } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h3", name: "edit_file", input: { path: "math.mjs", old_string: "a - b", new_string: "a + b" } }] },
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "h4", name: "run_tests", input: { command: "node --test" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Fixed: `add` subtracted instead of adding. All 3 tests pass. Good metal now." }] },
  ],
  momus: [
    { stop_reason: "end_turn", content: [{ type: "text", text: "A one-character fix. Truly, the bards will sing of it.\n\nNo real findings.\n\nVERDICT: APPROVED" }] },
  ],
};

function fakeClient(god: string) {
  return {
    beta: {
      messages: {
        stream() {
          const msg = scripts[god].shift();
          const on: Record<string, (d: string) => void> = {};
          return {
            on(name: string, fn: (d: string) => void) {
              on[name] = fn;
              return this;
            },
            async finalMessage() {
              await new Promise((r) => setTimeout(r, 150));
              on.thinking?.("Weighing where the crack in the casting is…");
              for (const b of msg.content) if (b.type === "text") on.text?.(b.text);
              return { usage: { input_tokens: 1, output_tokens: 1 }, stop_details: null, ...msg };
            },
          };
        },
      },
    },
  } as any;
}

const session = new Session({ root: project, mute: true });
if (!live) {
  const s = session as any;
  const approve = (req: any) => s.approve(req);
  const make = (god: string, tools?: string[]) =>
    new Agent({ god: god as any, client: fakeClient(god), config: session.config, root: project, bus: session.bus, approve, tools });
  s.pantheon = { hephaestus: make("hephaestus"), athena: make("athena", READ_ONLY_TOOLS), momus: make("momus", READ_ONLY_TOOLS) };
  s.narrator.client = null; // template narration only
}
let inputTokens = 0;
let outputTokens = 0;
session.bus.on("turn_end", (t) => {
  inputTokens += t.inputTokens;
  outputTokens += t.outputTokens;
});
const errors: string[] = [];
session.bus.on("error", (e) => errors.push(e.message));

// Fake terminal.
const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
let output = "";
const stdout = Object.assign(
  new Writable({
    write(chunk, _enc, cb) {
      output += chunk.toString();
      cb();
    },
  }),
  { columns: 100, rows: 60, isTTY: true },
);

const app = render(<App session={session} />, { stdin: stdin as any, stdout: stdout as any, debug: true, exitOnCtrlC: false, patchConsole: false });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const type = async (text: string) => {
  for (const ch of text) {
    stdin.write(ch);
    await sleep(5);
  }
  stdin.write("\r");
};
const waitIdle = async () => {
  await sleep(300);
  for (let i = 0; i < (live ? 3000 : 200) && session.busy; i++) {
    stdin.write("y"); // answer any Oracle prompt
    await sleep(100);
  }
  await sleep(1500); // let the narrator's debounce fire
};

await sleep(300);
await type("fix the failing tests");
await waitIdle();
await type("/roast");
await waitIdle();
await type("/stats");
await sleep(300);
app.unmount();

const plain = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
// debug mode prints every frame; the last one holds the full transcript.
const frames = plain.split(/(?=    _    __  __ ____)/);
console.log(frames[frames.length - 1]);

const checks: Array<[string, boolean]> = [
  ["bug fixed on disk", fs.readFileSync(path.join(project, "math.mjs"), "utf8").includes("a + b")],
  ["oracle prompted", plain.includes("The Oracle asks")],
  ["monster spawned", /A (Harpy|Minotaur|Chimera|Hydra) appears/.test(plain)],
  ["monster slain", plain.includes("is slain")],
  ["First Blood earned", plain.includes("First Blood")],
  ...(live ? [] : [["Golden Fleece earned", plain.includes("Golden Fleece")] as [string, boolean]]),
  ["no errors", errors.length === 0],
  ["Hermes narrated", plain.includes("Hermes:")],
  ["profile saved", fs.existsSync(path.join(process.env.AMBROSIA_HOME!, "profile.json"))],
];
if (errors.length) console.log("Errors:\n" + errors.join("\n"));
if (live) console.log(`Tokens: ~${inputTokens} in, ${outputTokens} out`);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
fs.rmSync(scratch, { recursive: true, force: true });
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
