import { describe, expect, it } from "vitest";
import { completions, otherSpeaker, sceneParts, tabScene } from "./smarttype";

const talk = `@ALICE
Hi.

@BOB
Hello.

@`;

describe("smart type", () => {
  it("splits a slug into intro, location, and time", () => {
    expect(sceneParts("INT. KITCHEN - DAY")).toMatchObject({
      intro: "INT.",
      location: "KITCHEN",
      time: "DAY",
      locationStart: 5,
      timeStart: 15,
    });
    expect(sceneParts("INT.")).toMatchObject({ location: "", time: "", locationStart: 4 });
  });

  it("tabs from the intro to the location to the time", () => {
    expect(tabScene("INT.", 4)).toMatchObject({ visible: "INT. ", offset: 5, leave: false });
    expect(tabScene("INT. KIT", 8)).toMatchObject({ visible: "INT. KIT - ", leave: false });
    const filled = tabScene("INT. KITCHEN - DAY", 2);
    expect(filled.leave).toBe(false);
    expect(filled.visible.slice(filled.offset - "KITCHEN".length, filled.offset)).toBe("KITCHEN");
    expect(tabScene("INT. KITCHEN - DAY", "INT. KITCHEN - DAY".length).leave).toBe(true);
  });

  it("offers the other speaker first", () => {
    expect(otherSpeaker(talk, talk.lastIndexOf("@"))).toBe("ALICE");
    const list = completions(talk, talk.length);
    expect(list?.options[0]).toBe("ALICE");
    expect(list?.options).toContain("BOB");
  });

  it("offers extensions after a parenthesis", () => {
    const doc = "@BOB (";
    const list = completions(doc, doc.length);
    expect(list?.options).toContain("(V.O.)");
    expect(list?.options).toContain("(CONT'D)");
  });

  it("offers locations and times inside a slug", () => {
    const doc = "INT. KITCHEN - DAY\n\nINT. ";
    const atLocation = completions(doc, doc.length);
    expect(atLocation?.options).toEqual(["KITCHEN"]);
    const timed = "INT. KITCHEN - ";
    const atTime = completions(timed, timed.length);
    expect(atTime?.options[0]).toBe("DAY");
  });

  it("offers transitions", () => {
    const line = ">FADE";
    const list = completions(line, line.length);
    expect(list?.options).toContain("FADE IN:");
    expect(list?.options).toContain("FADE OUT.");
  });
});
