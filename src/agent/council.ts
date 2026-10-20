import type { Agent } from "./loop.js";
import type { Bus } from "../events.js";
import { runShell } from "./tools.js";

export interface Crew {
  fabricator: Agent;
  strategos: Agent;
  blackice: Agent;
}

export function parseVerdict(review: string): boolean | null {
  const m = review.match(/VERDICT:\s*(APPROVED|REVISE)/i);
  return m ? m[1].toUpperCase() === "APPROVED" : null;
}

/** The working-tree diff, including new files, for Black ICE to judge. */
export async function currentDiff(root: string): Promise<string> {
  const tracked = await runShell("git diff HEAD --stat; git diff HEAD", root, 30_000);
  const untracked = await runShell("git ls-files --others --exclude-standard", root, 30_000);
  if (tracked.exitCode !== 0 && /not a git repository/i.test(tracked.output)) {
    return "(This project is not a git repository, so there is no diff. Review the files mentioned in the task instead.)";
  }
  const news = untracked.output.trim();
  return `${tracked.output.trim() || "(no changes to tracked files)"}${news ? `\n\nNew untracked files:\n${news}` : ""}`;
}

async function review(p: Crew, root: string, context: string, signal?: AbortSignal): Promise<{ text: string; approved: boolean }> {
  const diff = await currentDiff(root);
  const r = await p.blackice.run(`${context}\n\n<diff>\n${diff.slice(0, 60_000)}\n</diff>`, signal);
  return { text: r.text, approved: parseVerdict(r.text) === true };
}

/** /heist: Strategos plans, Fabricator builds, Black ICE reviews, with one revision round if Black ICE objects. */
export async function runHeist(p: Crew, bus: Bus, root: string, task: string, signal?: AbortSignal): Promise<void> {
  bus.emit("notice", { text: "The crew assembles. Heist is on." });
  const plan = await p.strategos.run(`The job for this heist:\n\n${task}`, signal);
  if (signal?.aborted || plan.stopReason === "error") return;

  const build = await p.fabricator.run(
    `The crew has a job for you.\n\nJob: ${task}\n\nStrategos's plan:\n${plan.text}\n\nCarry it out. Black ICE will review your work afterwards.`,
    signal,
  );
  if (signal?.aborted || build.stopReason === "error") return;

  let verdict = await review(
    p,
    root,
    `Review Fabricator's work on this job: ${task}\n\nTheir summary:\n${build.text}`,
    signal,
  );
  bus.emit("review", { approved: verdict.approved });
  if (verdict.approved || signal?.aborted) return;

  bus.emit("notice", { text: "Black ICE found a hole. Back to the workbench." });
  const fix = await p.fabricator.run(`Black ICE reviewed your work and wants changes:\n\n${verdict.text}\n\nAddress the findings that are valid. If one is wrong, say why.`, signal);
  if (signal?.aborted || fix.stopReason === "error") return;
  verdict = await review(p, root, `Fabricator revised the work after your review. Their reply:\n${fix.text}\n\nJudge the current state.`, signal);
  bus.emit("review", { approved: verdict.approved });
}

/** /roast: Black ICE reviews whatever is currently uncommitted. */
export async function runRoast(p: Crew, bus: Bus, root: string, signal?: AbortSignal): Promise<void> {
  const verdict = await review(p, root, "Roast the uncommitted changes in this project.", signal);
  bus.emit("review", { approved: verdict.approved });
}
