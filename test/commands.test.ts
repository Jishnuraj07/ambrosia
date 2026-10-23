import { describe, expect, it } from "vitest";
import { COMMANDS, complete, suggest } from "../src/commands.js";

describe("command suggestions", () => {
  it("lists every command for a bare slash", () => {
    expect(suggest("/")).toEqual(COMMANDS);
  });

  it("narrows by prefix, ignoring case", () => {
    expect(suggest("/h").map((c) => c.name)).toEqual(["/heist", "/hacks", "/help"]);
    expect(suggest("/HE").map((c) => c.name)).toEqual(["/heist", "/help"]);
  });

  it("goes quiet for plain text, a finished command, or once arguments start", () => {
    expect(suggest("")).toEqual([]);
    expect(suggest("fix the tests")).toEqual([]);
    expect(suggest("/stats")).toEqual([]);
    expect(suggest("/heist add a cache")).toEqual([]);
    expect(suggest("/nope")).toEqual([]);
  });

  it("leaves room for an argument when the command takes one", () => {
    expect(complete(suggest("/hei")[0])).toBe("/heist ");
    expect(complete(suggest("/ro")[0])).toBe("/roast");
  });
});
