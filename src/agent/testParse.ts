import type { TestResult } from "../events.js";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

/** The last number before `word` on a summary line, e.g. "3 failed" or "# fail 3". */
function lastCount(text: string, patterns: RegExp[]): number | null {
  let found: number | null = null;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found = Number(m[1]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Read pass/fail counts from a test runner's output. Recognises the summary
 * lines of vitest, jest, mocha, pytest, cargo, go test and node --test; anything
 * else falls back to the exit code.
 */
export function parseTestOutput(raw: string, exitCode: number | null): TestResult {
  const text = stripAnsi(raw);

  const failed = lastCount(text, [
    /^\s*Tests?:?\s+.*?(\d+)\s+failed/gim, // vitest / jest
    /(\d+)\s+failed[,;\s]/gi, // pytest, cargo
    /(\d+)\s+failing/gi, // mocha
    /^[#ℹ]\s*fail\s+(\d+)/gim, // node --test (tap or spec reporter)
  ]);
  const passed = lastCount(text, [
    /^\s*Tests?:?\s+.*?(\d+)\s+passed/gim,
    /(\d+)\s+passed/gi,
    /(\d+)\s+passing/gi,
    /^[#ℹ]\s*pass\s+(\d+)/gim,
  ]);

  const failing = new Set<string>();
  const namePatterns = [
    /^\s*FAILED\s+(\S+)/gm, // pytest
    /^test\s+(\S+)\s+\.\.\.\s+FAILED/gm, // cargo
    /^\s*--- FAIL:\s+(\S+)/gm, // go
    /^\s*[×✗✕]\s+(.+?)(?:\s+\d+ms)?$/gm, // vitest / jest list
    /^\s*●\s+(.+?)$/gm, // jest detail headers
    /^not ok \d+ - (.+)$/gm, // tap
    /^\s*✖\s+(.+?)(?:\s+\([\d.]+m?s\))?$/gm, // node --test spec reporter
  ];
  for (const re of namePatterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1].trim();
      if (!/^failing tests:?$/i.test(name)) failing.add(name);
    }
  }

  // go test without -v prints no counts, only FAIL/ok lines.
  const goFails = (text.match(/^\s*--- FAIL:/gm) ?? []).length;
  const goPasses = (text.match(/^\s*--- PASS:/gm) ?? []).length;

  if (failed !== null || passed !== null) {
    return { failed: failed ?? 0, passed: passed ?? 0, failing: [...failing], parsed: true };
  }
  if (goFails || goPasses) {
    return { failed: goFails, passed: goPasses, failing: [...failing], parsed: true };
  }
  const exitFailed = exitCode !== 0 ? Math.max(1, failing.size) : 0;
  return { failed: exitFailed, passed: 0, failing: [...failing], parsed: false };
}
