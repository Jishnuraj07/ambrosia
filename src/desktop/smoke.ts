import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { Session } from "../session.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive the real window through the demo: type a task, answer the Oracle by
 * clicking, wait for the gods, then roast. Screenshots go to shotsDir if given.
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

  let oracleShot = false;
  let prompts = 0;
  const runTurn = async (text: string) => {
    await send(text);
    await sleep(300);
    for (let i = 0; i < 600 && (session.busy || (await js<boolean>(`!document.getElementById("oracle").hidden`))); i++) {
      if (await js<boolean>(`!document.getElementById("oracle").hidden`)) {
        prompts++;
        if (!oracleShot) {
          oracleShot = true;
          await sleep(300);
          await shot("2-oracle");
        } else if (prompts === 2) {
          // The monster is up by now; show the arena without the dialog over it.
          await js(`document.getElementById("oracle").hidden = true`);
          await shot("2b-fight");
          await js(`document.getElementById("oracle").hidden = false`);
        }
        await js(`document.getElementById("oracle-yes").click()`);
      }
      await sleep(100);
    }
    await sleep(1500); // narrator debounce, animations
  };

  await sleep(800);
  await js(`document.body.classList.add("no-anim")`);
  await shot("1-start");
  await runTurn("fix the failing tests");
  await js(`document.getElementById("ascension").hidden = true`);
  await sleep(300);
  await shot("3-fixed");
  await runTurn("/roast");
  await shot("4-roast");

  const text = await js<string>("document.getElementById('transcript').innerText");
  const labours = await js<string>("[...document.querySelectorAll('.labour-line')].map((e) => e.innerText).join(' | ')");
  const ring = await js<string>("document.getElementById('foe-name').textContent");
  // Transcript order: the boss must appear before it is slain, and the final reply after both.
  const order = (needle: string) => text.indexOf(needle);
  const checks: Array<[string, boolean]> = [
    ["bug fixed on disk", fs.readFileSync(path.join(session.root, "math.mjs"), "utf8").includes("a + b")],
    ["oracle shown", oracleShot],
    ["monster appeared", /A (Harpy|Minotaur|Chimera|Hydra) appears/.test(text)],
    ["monster slain", text.includes("is slain")],
    ["arena back to all clear", ring === "All clear" || ring.endsWith("slain")],
    ["First Blood in transcript", labours.includes("First Blood")],
    ["Golden Fleece earned", labours.includes("Golden Fleece")],
    ["Hephaestus replied", text.includes("Good metal now")],
    ["Hermes narrated", (await js<number>("document.querySelectorAll('.hermes').length")) > 0],
    ["transcript in order", order("appears") < order("is slain") && order("is slain") < order("Good metal now")],
    ["rank shown as Hero", (await js<string>(`document.getElementById("rank-name").textContent`)) === "Hero"],
    ["no renderer errors", errors.length === 0],
  ];
  for (const e of errors) console.log(`renderer error: ${e}`);
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}
