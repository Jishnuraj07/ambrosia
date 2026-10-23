import React from "react";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { BossBar, CrewBubble, HackCard, GatePrompt, StatusBar, Suggestions, ToolLine } from "../src/ui/components.js";
import { HACKS } from "../src/game/hacks.js";
import { suggest } from "../src/commands.js";

const plain = (node: React.ReactElement) => renderToString(node, { columns: 100 }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

describe("UI components", () => {
  it("StatusBar shows rank, progress and sound state", () => {
    const out = plain(<StatusBar xp={250} serious={false} sound={true} tts={false} />);
    expect(out).toContain("Runner");
    expect(out).toContain("▰".repeat(8) + "▱".repeat(8));
    expect(out).toContain("◆ 250 / 400 to Netrunner");
    expect(out).toContain("🔉");
  });

  it("StatusBar at the top rank and in serious mode", () => {
    expect(plain(<StatusBar xp={9999} serious={false} sound={false} tts={false} />)).toContain("top of the grid");
    expect(plain(<StatusBar xp={9999} serious={true} sound={false} tts={false} />)).toMatch(/^serious mode/);
  });

  it("Suggestions lists matching commands and marks the picked one", () => {
    const items = suggest("/h");
    const out = plain(<Suggestions items={items} picked={items[1]} />);
    expect(out).toContain("/heist <task>");
    expect(out).toMatch(/▸ \/hacks/);
    expect(out).not.toMatch(/▸ \/heist/);
    expect(out).toContain("Tab complete");
  });

  it("BossBar draws one block per failing test", () => {
    const out = plain(<BossBar boss={{ name: "Worm", hp: 2, maxHp: 5, startHp: 5 }} />);
    expect(out).toContain("Worm");
    expect(out).toContain("██░░░");
    expect(out).toContain("2/5 failing");
  });

  it("GatePrompt names the crew and the action, and warns about risky ones", () => {
    const req = { crew: "fabricator" as const, tool: "shell", summary: "rm -rf build", detail: "rm -rf build", risky: true };
    const out = plain(<GatePrompt req={req} />);
    expect(out).toContain("Operator check: may Fabricator run a command?");
    expect(out).toContain("This one looks dangerous");
    expect(out).toContain("rm -rf build");
    expect(plain(<GatePrompt req={{ ...req, tool: "edit_file", risky: false }} />)).not.toContain("dangerous");
  });

  it("CrewBubble, ToolLine and HackCard render their content", () => {
    expect(plain(<CrewBubble crew="blackice" text="  Dreadful.  " />)).toMatch(/❄ Black ICE[\s\S]*Dreadful\./);
    expect(plain(<ToolLine name="edit_file" summary="src/a.ts" ok={true} />)).toContain("✓ ⌨ edit_file src/a.ts");
    expect(plain(<ToolLine name="shell" summary="npm test" ok={false} result="boom" />)).toMatch(/✗[\s\S]*boom/);
    expect(plain(<HackCard hack={HACKS.fork_bomb} />)).toMatch(/Fork Bomb Survivor[\s\S]*\+100 cred/);
  });
});
