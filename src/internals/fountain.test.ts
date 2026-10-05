import { describe, expect, it } from "vitest";
import {
  editorDoc,
  elementAt,
  isBlankScript,
  parseScript,
  renderLine,
  sceneHeadings,
} from "./fountain";

const sample = `INT. KITCHEN - DAY

Bob fills the kettle.

BOB
You up?

ALICE
(from the hall)
I'm up.

CUT TO:


EXT. PORCH - DAY

CLOSE ON THE KETTLE

FADE OUT.`;

describe("elements", () => {
  it("reads a plain screenplay", () => {
    expect(parseScript(sample).map((element) => element.type)).toEqual([
      "scene",
      "action",
      "character",
      "dialogue",
      "character",
      "parenthetical",
      "dialogue",
      "transition",
      "scene",
      "shot",
      "transition",
    ]);
  });

  it("keeps a forced character that has no dialogue yet", () => {
    const element = elementAt("@BOB", 2);
    expect(element?.type).toBe("character");
    expect(element?.text).toBe("BOB");
    expect(element?.marker).toBe(1);
  });

  it("hides the markers in the visible text", () => {
    expect(parseScript("!BOOM.").map((element) => element.text)).toEqual(["BOOM."]);
    expect(parseScript("~CLOSE ON").map((element) => element.text)).toEqual(["CLOSE ON"]);
    expect(parseScript(".LATER").map((element) => [element.type, element.text])).toEqual([["scene", "LATER"]]);
  });

  it("does not treat an ellipsis as a scene heading", () => {
    expect(parseScript("...he waits.")[0].type).toBe("action");
  });

  it("renders each element in the form the file stores", () => {
    expect(renderLine("scene", "int. kitchen - day")).toBe("INT. KITCHEN - DAY");
    expect(renderLine("scene", "later")).toBe(".LATER");
    expect(renderLine("scene", "")).toBe(".");
    expect(renderLine("character", "bob")).toBe("@BOB");
    expect(renderLine("action", "Hello")).toBe("Hello");
    expect(renderLine("action", "BOOM.")).toBe("!BOOM.");
    expect(renderLine("action", "")).toBe("!");
    expect(renderLine("dialogue", "")).toBe("\u200B");
    expect(renderLine("dialogue", "Hello")).toBe("\u200BHello");
    expect(renderLine("dialogue", "Hello", false, true)).toBe("Hello");
    expect(renderLine("parenthetical", "quietly")).toBe("(quietly)");
    expect(renderLine("parenthetical", "")).toBe("()");
    expect(renderLine("transition", "cut to:")).toBe("CUT TO:");
    expect(renderLine("transition", "smash")).toBe(">SMASH");
    expect(renderLine("shot", "close on")).toBe("~CLOSE ON");
    expect(renderLine("act", "act one")).toBe("ACT ONE");
    expect(renderLine("act", "act i")).toBe("ACT I");
    expect(renderLine("act", "teaser")).toBe("#TEASER");
    expect(renderLine("act", "")).toBe("#");
    expect(renderLine("action", "ACT ONE")).toBe("!ACT ONE");
  });

  it("reads a plain act label and a forced act title", () => {
    expect(parseScript("ACT ONE")[0]).toMatchObject({ type: "act", text: "ACT ONE", marker: 0 });
    expect(parseScript("#TEASER")[0]).toMatchObject({ type: "act", text: "TEASER", marker: 1 });
    expect(parseScript("Act naturally.")[0].type).toBe("action");
    expect(parseScript("ACT ONE\n\nBob sits.")[0].type).toBe("act");
  });

  it("keeps a parenthetical and a dialogue line that stand alone", () => {
    expect(parseScript("(quietly)")[0]).toMatchObject({ type: "parenthetical", text: "(quietly)" });
    expect(parseScript("!(quietly)")[0]).toMatchObject({ type: "action", text: "(quietly)" });
    expect(parseScript("\u200BHello")[0]).toMatchObject({ type: "dialogue", text: "Hello", marker: 1 });
    expect(parseScript("\u200B")[0]).toMatchObject({ type: "dialogue", text: "", marker: 1 });
  });

  it("repairs a parenthetical that lost a parenthesis", () => {
    expect(renderLine("parenthetical", "(quietly")).toBe("(quietly)");
  });

  it("lists scene headings and ignores an empty script", () => {
    expect(sceneHeadings(sample).map((scene) => scene.text)).toEqual(["INT. KITCHEN - DAY", "EXT. PORCH - DAY"]);
    expect(isBlankScript("")).toBe(true);
    expect(isBlankScript(".")).toBe(true);
    expect(isBlankScript(sample)).toBe(false);
  });

  it("opens an empty script on a scene heading", () => {
    expect(editorDoc("")).toBe(".");
    expect(editorDoc("INT. KITCHEN - DAY\n")).toBe("INT. KITCHEN - DAY");
  });
});
