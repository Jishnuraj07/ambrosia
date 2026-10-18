import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Bus } from "../events.js";
import type { GodName } from "../config.js";
import { confine, isRisky } from "./safety.js";
import { parseTestOutput, stripAnsi } from "./testParse.js";

const MAX_OUTPUT = 30_000;
const IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.venv/**", "**/target/**"];

export interface ApprovalRequest {
  god: GodName;
  tool: string;
  summary: string;
  detail: string;
  risky: boolean;
}

export interface ToolContext {
  root: string;
  god: GodName;
  bus: Bus;
  /** Ask the Oracle (the user). Resolves true when the action may go ahead. */
  approve: (req: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
}

interface ToolDef<S extends z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  readOnly: boolean;
  /** One line for the transcript, e.g. `src/app.ts` or `npm test`. */
  summarize: (input: z.infer<S>) => string;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<string>;
}

function def<S extends z.ZodObject>(d: ToolDef<S>): ToolDef<S> {
  return d;
}

function clip(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  const half = MAX_OUTPUT / 2;
  return `${s.slice(0, half)}\n\n… [${s.length - MAX_OUTPUT} characters omitted] …\n\n${s.slice(-half)}`;
}

export interface ShellResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * PowerShell's -Command reports any failure as exit code 1. Pass through the
 * real exit code of the last native program instead, as bash would.
 */
function powershellScript(command: string): string {
  return `${command}\n$__ok = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $__ok) { exit 1 }`;
}

/** Kill a process and everything it started, so grandchildren can't hold the pipes open. */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    } else {
      process.kill(-pid, "SIGKILL"); // the child leads its own process group (detached)
    }
  } catch {
    // Already gone.
  }
}

export function runShell(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ShellResult> {
  const win = process.platform === "win32";
  const [exe, args] = win
    ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershellScript(command)]]
    : ["bash", ["-lc", command]];
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
      detached: !win,
      windowsHide: true,
    });
    let output = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener("abort", stop);
      resolve({ output: stripAnsi(output) + extra, exitCode, timedOut });
    };
    let grace: NodeJS.Timeout | undefined;
    const stop = () => {
      killTree(child.pid);
      // If something still holds the pipes, don't wait on it forever.
      grace = setTimeout(() => finish(null), 2000);
    };
    const onData = (d: Buffer) => {
      output += d.toString("utf8");
      if (output.length > MAX_OUTPUT * 4) output = output.slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (err) => finish(null, `\n${err.message}`));
    child.on("close", (code) => finish(timedOut || signal?.aborted ? null : code));
  });
}

async function gate(ctx: ToolContext, tool: string, summary: string, detail: string, risky = false): Promise<boolean> {
  const approved = await ctx.approve({ god: ctx.god, tool, summary, detail, risky });
  ctx.bus.emit("approval", { god: ctx.god, tool, summary, approved, risky });
  return approved;
}

const DECLINED = "The user declined this action. Ask them what they would like instead, or try a different approach.";

export const TOOLS = [
  def({
    name: "read_file",
    description: "Read a text file. Returns numbered lines. Use offset/limit for large files.",
    readOnly: true,
    schema: z.object({
      path: z.string().describe("Path relative to the project root"),
      offset: z.number().int().min(1).optional().describe("First line to read, 1-based"),
      limit: z.number().int().min(1).optional().describe("Number of lines to read (default 2000)"),
    }),
    summarize: (i) => i.path,
    run: async (i, ctx) => {
      const file = confine(ctx.root, i.path);
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      const start = (i.offset ?? 1) - 1;
      const slice = lines.slice(start, start + (i.limit ?? 2000));
      const body = slice.map((l, n) => `${String(start + n + 1).padStart(5)}\t${l}`).join("\n");
      const more = start + slice.length < lines.length ? `\n… ${lines.length - start - slice.length} more lines` : "";
      return clip(body + more) || "(empty file)";
    },
  }),
  def({
    name: "write_file",
    description: "Create or overwrite a file with the given content. Prefer edit_file for changes to existing files.",
    readOnly: false,
    schema: z.object({ path: z.string(), content: z.string() }),
    summarize: (i) => i.path,
    run: async (i, ctx) => {
      const file = confine(ctx.root, i.path);
      const exists = fs.existsSync(file);
      const lines = i.content.split("\n").length;
      if (!(await gate(ctx, "write_file", i.path, `${exists ? "overwrite" : "create"} ${i.path} (${lines} lines)`))) {
        return DECLINED;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, i.content);
      ctx.bus.emit("edit", { god: ctx.god, path: i.path });
      return `${exists ? "Overwrote" : "Created"} ${i.path} (${lines} lines).`;
    },
  }),
  def({
    name: "edit_file",
    description:
      "Replace an exact string in a file. old_string must match exactly (including whitespace) and be unique unless replace_all is true. Read the file first.",
    readOnly: false,
    schema: z.object({
      path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional(),
    }),
    summarize: (i) => i.path,
    run: async (i, ctx) => {
      const file = confine(ctx.root, i.path);
      const text = fs.readFileSync(file, "utf8");
      // Files with CRLF endings: match the model's LF text against them too.
      const crlf = text.includes("\r\n");
      const oldS = crlf ? i.old_string.replace(/\r?\n/g, "\r\n") : i.old_string;
      const newS = crlf ? i.new_string.replace(/\r?\n/g, "\r\n") : i.new_string;
      const count = text.split(oldS).length - 1;
      if (count === 0) throw new Error("old_string was not found in the file. Re-read it and copy the text exactly.");
      if (count > 1 && !i.replace_all) {
        throw new Error(`old_string occurs ${count} times. Add surrounding context to make it unique, or set replace_all.`);
      }
      const preview = `${i.path}\n- ${i.old_string.split("\n").slice(0, 6).join("\n- ")}\n+ ${i.new_string.split("\n").slice(0, 6).join("\n+ ")}`;
      if (!(await gate(ctx, "edit_file", i.path, preview))) return DECLINED;
      fs.writeFileSync(file, i.replace_all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS));
      ctx.bus.emit("edit", { god: ctx.god, path: i.path });
      return `Edited ${i.path} (${i.replace_all ? count : 1} replacement${count > 1 && i.replace_all ? "s" : ""}).`;
    },
  }),
  def({
    name: "glob",
    description: "Find files by glob pattern, e.g. `src/**/*.ts`. Ignores node_modules, .git and build output.",
    readOnly: true,
    schema: z.object({ pattern: z.string() }),
    summarize: (i) => i.pattern,
    run: async (i, ctx) => {
      const files = await fg(i.pattern, { cwd: ctx.root, ignore: IGNORE, dot: true, onlyFiles: true });
      files.sort();
      return files.length ? clip(files.slice(0, 500).join("\n") + (files.length > 500 ? `\n… ${files.length - 500} more` : "")) : "No files matched.";
    },
  }),
  def({
    name: "grep",
    description: "Search file contents with a JavaScript regular expression. Returns `path:line: text` matches.",
    readOnly: true,
    schema: z.object({
      pattern: z.string(),
      glob: z.string().optional().describe("Limit to files matching this glob (default **/*)"),
      ignore_case: z.boolean().optional(),
    }),
    summarize: (i) => `/${i.pattern}/${i.glob ? ` in ${i.glob}` : ""}`,
    run: async (i, ctx) => {
      const re = new RegExp(i.pattern, i.ignore_case ? "i" : "");
      const files = await fg(i.glob ?? "**/*", { cwd: ctx.root, ignore: IGNORE, dot: true, onlyFiles: true });
      const hits: string[] = [];
      for (const f of files.sort()) {
        const full = path.join(ctx.root, f);
        if (fs.statSync(full).size > 2_000_000) continue;
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("\0")) continue; // binary
        text.split(/\r?\n/).forEach((line, n) => {
          if (re.test(line)) hits.push(`${f}:${n + 1}: ${line.trim().slice(0, 300)}`);
        });
        if (hits.length >= 300) break;
      }
      return hits.length ? clip(hits.slice(0, 300).join("\n")) : "No matches.";
    },
  }),
  def({
    name: "shell",
    description:
      process.platform === "win32"
        ? "Run a PowerShell command in the project root. Use PowerShell syntax. Returns combined output and exit code. Use run_tests for test suites."
        : "Run a bash command in the project root. Returns combined output and exit code. Use run_tests for test suites.",
    readOnly: false,
    schema: z.object({
      command: z.string(),
      timeout_ms: z.number().int().min(1000).max(600_000).optional().describe("Default 120000"),
    }),
    summarize: (i) => i.command,
    run: async (i, ctx) => {
      const risky = isRisky(i.command);
      const approved = await gate(ctx, "shell", i.command, i.command, risky);
      if (!approved) {
        ctx.bus.emit("shell_result", { god: ctx.god, command: i.command, exitCode: null, risky, approved });
        return DECLINED;
      }
      const r = await runShell(i.command, ctx.root, i.timeout_ms ?? 120_000, ctx.signal);
      ctx.bus.emit("shell_result", { god: ctx.god, command: i.command, exitCode: r.exitCode, risky, approved });
      return clip(`${r.output.trim() || "(no output)"}\n\n[exit code ${r.exitCode}${r.timedOut ? ", timed out" : ""}]`);
    },
  }),
  def({
    name: "run_tests",
    description:
      "Run the project's test suite (or a subset) and report pass/fail counts. Always use this instead of shell for running tests.",
    readOnly: false,
    schema: z.object({
      command: z.string().describe("The test command, e.g. `npx vitest run`, `pytest -q`, `cargo test`"),
    }),
    summarize: (i) => i.command,
    run: async (i, ctx) => {
      if (!(await gate(ctx, "run_tests", i.command, i.command))) return DECLINED;
      const r = await runShell(i.command, ctx.root, 600_000, ctx.signal);
      const result = parseTestOutput(r.output, r.exitCode);
      ctx.bus.emit("test_result", result);
      const head = `Tests: ${result.failed} failed, ${result.passed} passed${result.parsed ? "" : " (counts inferred from exit code)"}`;
      return clip(`${head}\n\n${r.output.trim()}\n\n[exit code ${r.exitCode}${r.timedOut ? ", timed out" : ""}]`);
    },
  }),
];

export type AnyTool = (typeof TOOLS)[number];

export const READ_ONLY_TOOLS = TOOLS.filter((t) => t.readOnly).map((t) => t.name);

/** API definitions. Kept in a fixed order so the tool list stays cache-stable. */
export function toolParams(names?: string[]): Anthropic.Beta.BetaTool[] {
  return TOOLS.filter((t) => !names || names.includes(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.schema) as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));
}

export function findTool(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
