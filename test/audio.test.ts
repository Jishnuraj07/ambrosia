import { describe, expect, it } from "vitest";
import { EARCONS, synthesize } from "../src/audio/earcons.js";

describe("synthesize", () => {
  it("produces a valid PCM WAV of the right length", () => {
    const wav = synthesize(EARCONS.success);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    const seconds = EARCONS.success.reduce((s, [, d]) => s + d, 0);
    const dataBytes = wav.readUInt32LE(40);
    expect(dataBytes / 2 / 22_050).toBeCloseTo(seconds, 2);
    expect(wav.length).toBe(44 + dataBytes);
  });
});
