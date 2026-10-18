import React from "react";
import { render } from "ink";
import { parseArgs } from "node:util";
import path from "node:path";
import { App } from "./ui/App.js";
import { Session } from "./session.js";
import { EARCONS, play, type Earcon } from "./audio/earcons.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    serious: { type: "boolean", default: false },
    mute: { type: "boolean", default: false },
    yolo: { type: "boolean", default: false },
    cwd: { type: "string" },
    "test-sounds": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`ambrosia: a mythic coding-agent harness

Usage: ambrosia [task] [options]

  --serious       no narration, sound or ambrosia; just the agent
  --mute          no sound or speech
  --yolo          never ask the Oracle; approve every action (careful)
  --cwd <dir>     project root (default: current directory)
  --test-sounds   play every earcon and exit

Needs ANTHROPIC_API_KEY in the environment, or a profile from \`ant auth login\`.
Config and progress live in ~/.ambrosia/ (override with AMBROSIA_HOME).`);
  process.exit(0);
}

if (values["test-sounds"]) {
  const names = Object.keys(EARCONS) as Earcon[];
  for (const [i, name] of names.entries()) {
    setTimeout(() => {
      console.log(`♪ ${name}`);
      play(name);
    }, i * 1200);
  }
  setTimeout(() => process.exit(0), names.length * 1200 + 800);
} else {
  const root = path.resolve(values.cwd ?? process.cwd());
  const session = new Session({ root, serious: values.serious, mute: values.mute, yolo: values.yolo });
  const app = render(<App session={session} initialPrompt={positionals.join(" ") || undefined} />, { exitOnCtrlC: true });
  await app.waitUntilExit();
  session.engine.dispose();
  process.exit(0);
}
