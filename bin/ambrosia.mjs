#!/usr/bin/env node
// Launcher: runs the TypeScript entry through tsx so there is no build step.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli", { paths: [root] });

const child = spawn(process.execPath, [tsxCli, join(root, "src", "cli.tsx"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
