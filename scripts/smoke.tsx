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
import { PassThrough, Writable } from "node:stream";
import React from "react";
import { render } from "ink";

const live = process.argv.includes("--live");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ambrosia-smoke-"));
process.env.AMBROSIA_HOME = path.join(scratch, ".home");
const project = path.join(scratch, "project");

const { Session } = await import("../src/session.js");
const { App } = await import("../src/ui/App.js");
const { createDemoProject, createScriptedClient, demoScripts } = await import("../src/testing/demo.js");

createDemoProject(project);
const session = new Session({ root: project, mute: true, client: live ? undefined : createScriptedClient(demoScripts()) });
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
