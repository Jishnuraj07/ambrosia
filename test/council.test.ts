import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Bus } from "../src/events.js";
import { currentDiff, runHeist, runRoast, type Crew } from "../src/agent/council.js";
import type { RunResult } from "../src/agent/loop.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ambrosia-council-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A crew member that replies from a script and records what it was told. */
function fakeCrew(replies: string[]) {
  const prompts: string[] = [];
  return {
    prompts,
    async run(prompt: string): Promise<RunResult> {
      prompts.push(prompt);
      return { text: replies.shift() ?? "", stopReason: "end_turn" };
    },
    reset() {},
  };
}

function crew(strategos: string[], fabricator: string[], blackice: string[]) {
  const members = { strategos: fakeCrew(strategos), fabricator: fakeCrew(fabricator), blackice: fakeCrew(blackice) };
  return { members, p: members as unknown as Crew };
}

function listen(bus: Bus) {
  const reviews: boolean[] = [];
  const notices: string[] = [];
  bus.on("review", (r) => reviews.push(r.approved));
  bus.on("notice", (n) => notices.push(n.text));
  return { reviews, notices };
}

describe("runHeist", () => {
  it("passes Strategos's plan to Fabricator and stops when Black ICE approves", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { members, p } = crew(["1. Edit cli.ts"], ["Added the flag."], ["Adequate.\nVERDICT: APPROVED"]);

    await runHeist(p, bus, root, "add a --version flag");

    expect(members.strategos.prompts[0]).toContain("add a --version flag");
    expect(members.fabricator.prompts).toHaveLength(1);
    expect(members.fabricator.prompts[0]).toContain("1. Edit cli.ts");
    expect(members.blackice.prompts[0]).toContain("Added the flag.");
    expect(members.blackice.prompts[0]).toContain("<diff>");
    expect(reviews).toEqual([true]);
  });

  it("sends Fabricator back once when Black ICE wants changes", async () => {
    const bus = new Bus();
    const { reviews, notices } = listen(bus);
    const { members, p } = crew(["plan"], ["first try", "fixed it"], ["Off-by-one.\nVERDICT: REVISE", "Fine.\nVERDICT: APPROVED"]);

    await runHeist(p, bus, root, "task");

    expect(members.fabricator.prompts).toHaveLength(2);
    expect(members.fabricator.prompts[1]).toContain("Off-by-one.");
    expect(reviews).toEqual([false, true]);
    expect(notices).toContain("Black ICE found a hole. Back to the workbench.");
  });

  it("allows only one revision round", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { members, p } = crew(["plan"], ["a", "b", "c"], ["VERDICT: REVISE", "VERDICT: REVISE", "VERDICT: REVISE"]);
    await runHeist(p, bus, root, "task");
    expect(members.fabricator.prompts).toHaveLength(2);
    expect(reviews).toEqual([false, false]);
  });

  it("stops if a crew member's turn errors", async () => {
    const bus = new Bus();
    const { members, p } = crew(["plan"], [], []);
    members.strategos.run = async () => ({ text: "", stopReason: "error" });
    await runHeist(p, bus, root, "task");
    expect(members.fabricator.prompts).toEqual([]);
  });

  it("stops when interrupted", async () => {
    const bus = new Bus();
    const ac = new AbortController();
    const { members, p } = crew(["plan"], ["built"], ["VERDICT: APPROVED"]);
    const run = members.strategos.run.bind(members.strategos);
    members.strategos.run = async (prompt: string) => {
      ac.abort();
      return run(prompt);
    };
    await runHeist(p, bus, root, "task", ac.signal);
    expect(members.fabricator.prompts).toEqual([]);
  });
});

describe("runRoast", () => {
  it("asks Black ICE about the diff and reports the verdict", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { members, p } = crew([], [], ["Pathetic.\nVERDICT: REVISE"]);
    await runRoast(p, bus, root);
    expect(members.blackice.prompts[0]).toMatch(/Roast the uncommitted changes/);
    expect(reviews).toEqual([false]);
  });
});

describe("currentDiff", () => {
  it("explains when the project is not a git repository", async () => {
    expect(await currentDiff(root)).toMatch(/not a git repository/);
  });
});
