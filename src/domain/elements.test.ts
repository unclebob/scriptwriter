import { describe, expect, it } from "vitest";
import { blanksBefore, convertText, formatText, shiftTabType, tabType } from "./elements";

describe("element text", () => {
  it("puts a blank before every element except dialogue and parentheticals", () => {
    expect(blanksBefore("dialogue")).toBe(0);
    expect(blanksBefore("parenthetical")).toBe(0);
    expect(blanksBefore("action")).toBe(1);
    expect(blanksBefore("shot")).toBe(1);
  });

  it("uppercases headings, cues, transitions, shots, and acts", () => {
    expect(formatText("shot", "wide")).toBe("WIDE");
    expect(formatText("act", "one")).toBe("ONE");
    expect(formatText("scene", "room")).toBe("ROOM");
    expect(formatText("character", "bob")).toBe("BOB");
    expect(formatText("transition", "cut to:")).toBe("CUT TO:");
    expect(formatText("action", "Hi")).toBe("Hi");
    expect(formatText("parenthetical", "quietly")).toBe("(quietly)");
    expect(formatText("parenthetical", "(quietly)")).toBe("(quietly)");
    expect(formatText("parenthetical", "quietly)")).toBe("(quietly)");
    expect(formatText("parenthetical", "(quietly")).toBe("(quietly)");
  });

  it("cycles element types in both directions", () => {
    expect(tabType("scene")).toBe("action");
    expect(tabType("act")).toBe("scene");
    expect(shiftTabType("scene")).toBe("act");
    expect(shiftTabType("action")).toBe("scene");
  });

  it("strips parentheses only when leaving a parenthetical", () => {
    expect(convertText("action", "dialogue", "(hello)")).toBe("(hello)");
    expect(convertText("parenthetical", "action", "hello)")).toBe("hello)");
    expect(convertText("parenthetical", "action", "(hello)")).toBe("hello");
    expect(convertText("parenthetical", "dialogue", "(hello")).toBe("(hello");
  });
});
