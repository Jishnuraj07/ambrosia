import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { Session } from "../session.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive the real window through the demo: type a task, answer the Operator check
 * by clicking, wait for the crew, then roast. Screenshots go to shotsDir if given.
 * Returns the process exit code.
 */
export async function runDesktopSmoke({ win, session, shotsDir }: { win: BrowserWindow; session: Session; shotsDir?: string }): Promise<number> {
  const errors: string[] = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  session.bus.on("test_result", (r) => console.log(`test_result: ${r.failed} failed, ${r.passed} passed (parsed: ${r.parsed})`));
  session.bus.on("tool_end", (t) => console.log(`tool ${t.name}: ${t.ok ? "ok" : "failed"} · ${t.summary}`));
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shot = async (name: string) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    // A hidden window only repaints on demand; ask for a fresh frame first.
    win.webContents.invalidate();
    await sleep(300);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), image.toPNG());
  };
  const send = (text: string) =>
    js(`(() => { const p = document.getElementById("prompt"); p.value = ${JSON.stringify(text)}; document.getElementById("send").click(); })()`);

  let gateShot = false;
  let prompts = 0;
  const runTurn = async (text: string) => {
    await send(text);
    await sleep(300);
    for (let i = 0; i < 600 && (session.busy || (await js<boolean>(`!document.getElementById("gate").hidden`))); i++) {
      if (await js<boolean>(`!document.getElementById("gate").hidden`)) {
        prompts++;
        if (!gateShot) {
          gateShot = true;
          await sleep(300);
          await shot("2-gate");
        } else if (prompts === 2) {
          // The threat is up by now; show the arena without the dialog over it.
          await js(`document.getElementById("gate").hidden = true`);
          await shot("2b-fight");
          await js(`document.getElementById("gate").hidden = false`);
        }
        await js(`document.getElementById("gate-yes").click()`);
      }
      await sleep(100);
    }
    await sleep(1500); // narrator debounce, animations
  };

  await sleep(800);
  await js(`document.body.classList.add("no-anim")`);
  await shot("1-start");
  // Half-type a command: the suggestions open, arrows move, Tab completes.
  const key = (k: string) => js(`document.getElementById("prompt").dispatchEvent(new KeyboardEvent("keydown", { key: "${k}", bubbles: true }))`);
  const typeIn = (v: string) => js(`(() => { const p = document.getElementById("prompt"); p.value = "${v}"; p.dispatchEvent(new Event("input")); })()`);
  await typeIn("/h");
  const suggested = await js<string[]>(`[...document.querySelectorAll(".suggest-item")].map((e) => e.firstChild.textContent)`);
  await key("ArrowDown");
  await shot("1b-commands");
  await key("Tab");
  const completed = await js<string>(`document.getElementById("prompt").value`);
  await typeIn("/s");
  await key("Escape");
  const dismissed = await js<boolean>(`document.getElementById("suggest").hidden && document.getElementById("prompt").value === ""`);
  await runTurn("fix the failing tests");
  await js(`document.getElementById("upgrade").hidden = true`);
  await sleep(300);
  await shot("3-fixed");
  await runTurn("/roast");
  await shot("4-roast");

  const text = await js<string>("document.getElementById('transcript').innerText");
  const hacks = await js<string>("[...document.querySelectorAll('.hack-line')].map((e) => e.textContent).join(' | ')");
  const ring = await js<string>("document.getElementById('foe-name').textContent");
  // Transcript order: the threat must appear before it is purged, and the final reply after both.
  const order = (needle: string) => text.indexOf(needle);
  const checks: Array<[string, boolean]> = [
    ["bug fixed on disk", fs.readFileSync(path.join(session.root, "math.mjs"), "utf8").includes("a + b")],
    ["commands suggested", suggested.join(" ") === "/heist <task> /hacks /help"],
    ["Tab completes the picked command", completed === "/hacks"],
    ["Esc dismisses suggestions", dismissed],
    ["gate shown", gateShot],
    ["threat appeared", /A (Bug|Daemon|Worm|Rogue AI) appears/.test(text)],
    ["threat purged", text.includes("is purged")],
    ["arena back to all clear", ring === "All clear" || ring.endsWith("purged")],
    ["First Blood in transcript", hacks.includes("First Blood")],
    ["Cracked the ICE earned", hacks.includes("Cracked the ICE")],
    ["Fabricator replied", text.includes("Clean signal now")],
    ["Pirate Radio narrated", (await js<number>("document.querySelectorAll('.radio').length")) > 0],
    ["transcript in order", order("appears") < order("is purged") && order("is purged") < order("Clean signal now")],
    ["rank shown as Runner", (await js<string>(`document.getElementById("rank-name").textContent`)) === "Runner"],
    ["no renderer errors", errors.length === 0],
  ];
  for (const e of errors) console.log(`renderer error: ${e}`);
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}
