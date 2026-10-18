import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Bus } from "../src/events.js";
import { currentDiff, runCouncil, runRoast, type Pantheon } from "../src/agent/council.js";
import type { RunResult } from "../src/agent/loop.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ambrosia-council-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A god that replies from a script and records what it was told. */
function fakeGod(replies: string[]) {
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

function pantheon(athena: string[], hephaestus: string[], momus: string[]) {
  const gods = { athena: fakeGod(athena), hephaestus: fakeGod(hephaestus), momus: fakeGod(momus) };
  return { gods, p: gods as unknown as Pantheon };
}

function listen(bus: Bus) {
  const reviews: boolean[] = [];
  const notices: string[] = [];
  bus.on("review", (r) => reviews.push(r.approved));
  bus.on("notice", (n) => notices.push(n.text));
  return { reviews, notices };
}

describe("runCouncil", () => {
  it("passes Athena's plan to Hephaestus and stops when Momus approves", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { gods, p } = pantheon(["1. Edit cli.ts"], ["Added the flag."], ["Adequate.\nVERDICT: APPROVED"]);

    await runCouncil(p, bus, root, "add a --version flag");

    expect(gods.athena.prompts[0]).toContain("add a --version flag");
    expect(gods.hephaestus.prompts).toHaveLength(1);
    expect(gods.hephaestus.prompts[0]).toContain("1. Edit cli.ts");
    expect(gods.momus.prompts[0]).toContain("Added the flag.");
    expect(gods.momus.prompts[0]).toContain("<diff>");
    expect(reviews).toEqual([true]);
  });

  it("sends Hephaestus back once when Momus wants changes", async () => {
    const bus = new Bus();
    const { reviews, notices } = listen(bus);
    const { gods, p } = pantheon(["plan"], ["first try", "fixed it"], ["Off-by-one.\nVERDICT: REVISE", "Fine.\nVERDICT: APPROVED"]);

    await runCouncil(p, bus, root, "task");

    expect(gods.hephaestus.prompts).toHaveLength(2);
    expect(gods.hephaestus.prompts[1]).toContain("Off-by-one.");
    expect(reviews).toEqual([false, true]);
    expect(notices).toContain("Momus is not satisfied. Back to the forge.");
  });

  it("allows only one revision round", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { gods, p } = pantheon(["plan"], ["a", "b", "c"], ["VERDICT: REVISE", "VERDICT: REVISE", "VERDICT: REVISE"]);
    await runCouncil(p, bus, root, "task");
    expect(gods.hephaestus.prompts).toHaveLength(2);
    expect(reviews).toEqual([false, false]);
  });

  it("stops if a god's turn errors", async () => {
    const bus = new Bus();
    const { gods, p } = pantheon(["plan"], [], []);
    gods.athena.run = async () => ({ text: "", stopReason: "error" });
    await runCouncil(p, bus, root, "task");
    expect(gods.hephaestus.prompts).toEqual([]);
  });

  it("stops when interrupted", async () => {
    const bus = new Bus();
    const ac = new AbortController();
    const { gods, p } = pantheon(["plan"], ["built"], ["VERDICT: APPROVED"]);
    const run = gods.athena.run.bind(gods.athena);
    gods.athena.run = async (prompt: string) => {
      ac.abort();
      return run(prompt);
    };
    await runCouncil(p, bus, root, "task", ac.signal);
    expect(gods.hephaestus.prompts).toEqual([]);
  });
});

describe("runRoast", () => {
  it("asks Momus about the diff and reports the verdict", async () => {
    const bus = new Bus();
    const { reviews } = listen(bus);
    const { gods, p } = pantheon([], [], ["Pathetic.\nVERDICT: REVISE"]);
    await runRoast(p, bus, root);
    expect(gods.momus.prompts[0]).toMatch(/Roast the uncommitted changes/);
    expect(reviews).toEqual([false]);
  });
});

describe("currentDiff", () => {
  it("explains when the project is not a git repository", async () => {
    expect(await currentDiff(root)).toMatch(/not a git repository/);
  });
});
