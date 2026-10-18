import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { emptyProfile, loadProfile, localDay, saveProfile } from "../src/game/profile.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "ambrosia-config-"));
  process.env.AMBROSIA_HOME = home;
});
afterEach(() => {
  delete process.env.AMBROSIA_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("writes the defaults on first run", () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    expect(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"))).toEqual(DEFAULT_CONFIG);
  });

  it("merges a partial user config over the defaults", () => {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ sound: false, models: { momus: "claude-opus-5-5" } }));
    const c = loadConfig();
    expect(c.sound).toBe(false);
    expect(c.models.momus).toBe("claude-opus-5-5");
    expect(c.models.hephaestus).toBe(DEFAULT_CONFIG.models.hephaestus);
    expect(c.effort).toEqual(DEFAULT_CONFIG.effort);
  });

  it("survives a corrupt config file", () => {
    fs.writeFileSync(path.join(home, "config.json"), "{ not json");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});

describe("profile persistence", () => {
  it("round-trips through disk", () => {
    const p = emptyProfile();
    p.xp = 123;
    p.labours.first_blood = "2026-10-18T00:00:00.000Z";
    p.stats.failCounts["a test"] = 2;
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
    expect(fs.existsSync(path.join(home, "profile.json.tmp"))).toBe(false);
  });

  it("starts fresh when the file is missing or corrupt", () => {
    expect(loadProfile()).toEqual(emptyProfile());
    fs.writeFileSync(path.join(home, "profile.json"), "garbage");
    expect(loadProfile()).toEqual(emptyProfile());
  });

  it("fills in stats added in newer versions", () => {
    fs.writeFileSync(path.join(home, "profile.json"), JSON.stringify({ xp: 50, stats: { sessions: 3 } }));
    const p = loadProfile();
    expect(p.xp).toBe(50);
    expect(p.stats.sessions).toBe(3);
    expect(p.stats.failCounts).toEqual({});
  });

  it("localDay uses the local calendar date", () => {
    const d = new Date(2026, 9, 18, 23, 30); // 18 Oct, 23:30 local
    expect(localDay(d)).toBe("2026-10-18");
  });
});
