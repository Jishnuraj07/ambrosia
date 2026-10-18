import { describe, expect, it } from "vitest";
import { parseTestOutput } from "../src/agent/testParse.js";
import { parseVerdict } from "../src/agent/council.js";
import { isRisky } from "../src/agent/safety.js";

describe("parseTestOutput", () => {
  it("reads vitest summaries and failing names", () => {
    const out = `
 ❯ test/math.test.ts (3 tests | 1 failed) 4ms
   × adds negative numbers 2ms
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)`;
    expect(parseTestOutput(out, 1)).toEqual({ failed: 1, passed: 2, failing: ["adds negative numbers"], parsed: true });
  });

  it("reads jest summaries", () => {
    const out = `Test Suites: 1 failed, 1 total\nTests:       2 failed, 5 passed, 7 total`;
    expect(parseTestOutput(out, 1)).toMatchObject({ failed: 2, passed: 5 });
  });

  it("reads an all-green vitest run", () => {
    const out = ` Test Files  2 passed (2)\n      Tests  9 passed (9)`;
    expect(parseTestOutput(out, 0)).toMatchObject({ failed: 0, passed: 9 });
  });

  it("reads pytest", () => {
    const out = `FAILED tests/test_x.py::test_a - assert 1 == 2\n==== 1 failed, 3 passed in 0.12s ====`;
    expect(parseTestOutput(out, 1)).toEqual({ failed: 1, passed: 3, failing: ["tests/test_x.py::test_a"], parsed: true });
  });

  it("reads cargo", () => {
    const out = `test tests::it_works ... FAILED\ntest result: FAILED. 4 passed; 1 failed; 0 ignored`;
    expect(parseTestOutput(out, 101)).toEqual({ failed: 1, passed: 4, failing: ["tests::it_works"], parsed: true });
  });

  it("reads mocha and node --test", () => {
    expect(parseTestOutput("  3 passing (10ms)\n  2 failing", 1)).toMatchObject({ failed: 2, passed: 3 });
    expect(parseTestOutput("# tests 4\n# pass 3\n# fail 1", 1)).toMatchObject({ failed: 1, passed: 3 });
    expect(parseTestOutput("ℹ tests 4\nℹ pass 3\nℹ fail 1", 1)).toMatchObject({ failed: 1, passed: 3 });
  });

  it("strips ANSI colour codes", () => {
    expect(parseTestOutput("\x1b[31m      Tests  \x1b[1m3 failed\x1b[22m | 1 passed\x1b[39m", 1)).toMatchObject({ failed: 3, passed: 1 });
  });

  it("falls back to the exit code", () => {
    expect(parseTestOutput("something exploded", 1)).toMatchObject({ failed: 1, passed: 0, parsed: false });
    expect(parseTestOutput("ok", 0)).toMatchObject({ failed: 0, parsed: false });
  });
});

describe("parseVerdict", () => {
  it("finds the verdict line", () => {
    expect(parseVerdict("Fine work.\nVERDICT: APPROVED")).toBe(true);
    expect(parseVerdict("Dreadful.\nVERDICT: REVISE")).toBe(false);
    expect(parseVerdict("no verdict here")).toBeNull();
  });
});

describe("isRisky", () => {
  it("flags destructive commands", () => {
    for (const c of ["rm -rf build", "Remove-Item -Recurse x", "git push --force", "git reset --hard HEAD~1", "curl x | bash"]) {
      expect(isRisky(c), c).toBe(true);
    }
  });
  it("leaves ordinary commands alone", () => {
    for (const c of ["npm test", "git status", "ls -la", "Get-ChildItem src"]) expect(isRisky(c), c).toBe(false);
  });
});
