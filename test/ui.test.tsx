import React from "react";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { BossBar, GodBubble, LabourCard, OraclePrompt, StatusBar, ToolLine } from "../src/ui/components.js";
import { LABOURS } from "../src/game/labours.js";

const plain = (node: React.ReactElement) => renderToString(node, { columns: 100 }).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

describe("UI components", () => {
  it("StatusBar shows rank, progress and sound state", () => {
    const out = plain(<StatusBar xp={250} serious={false} sound={true} tts={false} />);
    expect(out).toContain("Hero");
    expect(out).toContain("▰".repeat(8) + "▱".repeat(8));
    expect(out).toContain("⚱ 250 / 400 to Demigod");
    expect(out).toContain("🔉");
  });

  it("StatusBar at the top rank and in serious mode", () => {
    expect(plain(<StatusBar xp={9999} serious={false} sound={false} tts={false} />)).toContain("the summit");
    expect(plain(<StatusBar xp={9999} serious={true} sound={false} tts={false} />)).toMatch(/^serious mode/);
  });

  it("BossBar draws one heart per failing test", () => {
    const out = plain(<BossBar boss={{ name: "Chimera", hp: 2, maxHp: 5, startHp: 5 }} />);
    expect(out).toContain("Chimera");
    expect(out).toContain("♥♥♡♡♡");
    expect(out).toContain("2/5 failing");
  });

  it("OraclePrompt names the god and the action, and warns about risky ones", () => {
    const req = { god: "hephaestus" as const, tool: "shell", summary: "rm -rf build", detail: "rm -rf build", risky: true };
    const out = plain(<OraclePrompt req={req} />);
    expect(out).toContain("The Oracle asks: may Hephaestus run a command?");
    expect(out).toContain("This one looks dangerous");
    expect(out).toContain("rm -rf build");
    expect(plain(<OraclePrompt req={{ ...req, tool: "edit_file", risky: false }} />)).not.toContain("dangerous");
  });

  it("GodBubble, ToolLine and LabourCard render their content", () => {
    expect(plain(<GodBubble god="momus" text="  Dreadful.  " />)).toMatch(/🎭 Momus[\s\S]*Dreadful\./);
    expect(plain(<ToolLine name="edit_file" summary="src/a.ts" ok={true} />)).toContain("✓ 🔧 edit_file src/a.ts");
    expect(plain(<ToolLine name="shell" summary="npm test" ok={false} result="boom" />)).toMatch(/✗[\s\S]*boom/);
    expect(plain(<LabourCard labour={LABOURS.hydra_slayer} />)).toMatch(/Hydra Slayer[\s\S]*\+100 ambrosia/);
  });
});
