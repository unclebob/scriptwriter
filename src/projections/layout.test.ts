import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements, type ScriptElement } from "../domain/document";
import { LINES_PER_PAGE, pageAt, pageStarts, paginate, withContd, wrapText } from "./layout";

function document(elements: readonly Omit<ScriptElement, "blanksBefore">[]) {
  return elementsDocument(normalizeElements(elements));
}

describe("pagination", () => {
  it("wraps text at the element width", () => {
    expect(wrapText("one two three four", 8)).toEqual(["one two", "three", "four"]);
    expect(wrapText("superduper", 5)).toEqual(["super", "duper"]);
    expect(wrapText("", 8)).toEqual([""]);
  });

  it("keeps a scene heading with what follows", () => {
    const elements: Omit<ScriptElement, "blanksBefore">[] = Array.from({ length: 53 }, (_, index) => ({
      type: "action" as const,
      text: `Line ${index}.`,
    }));
    elements.push({ type: "scene", text: "ROOM" });
    elements.push({ type: "action", text: "Bob enters." });
    const pages = paginate(document(elements));
    const heading = pages.findIndex((page) => page.some((line) => line.text === "ROOM"));
    const action = pages.findIndex((page) => page.some((line) => line.text === "Bob enters."));
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBe(action);
  });

  it("adds dialogue continuation labels without losing speech", () => {
    const speech = "word ".repeat(500).trim();
    const pages = paginate(
      document([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: speech },
      ]),
    );
    expect(pages[0].at(-1)?.text).toBe("(MORE)");
    expect(pages[1][0].text).toBe("BOB (CONT'D)");
    expect(pages.flat().filter((line) => line.role === "dialogue").map((line) => line.text).join(" ")).toBe(speech);
    expect(withContd("BOB (CONT'D)")).toBe("BOB (CONT'D)");
    expect(withContd("BOB (cont'd)")).toBe("BOB (cont'd)");
    expect(withContd("BOB (CONT’D)")).toBe("BOB (CONT’D)");
  });

  it("wraps a character cue inside the right margin", () => {
    const cue = "A".repeat(40);
    const pages = paginate(document([{ type: "character", text: cue }]));
    expect(pages[0][0].text).toHaveLength(38);
    expect(pages.flat().filter((line) => line.role === "character").map((line) => line.text).join("")).toBe(cue);
  });

  it("keeps a character cue with the parenthetical and dialogue it introduces", () => {
    const elements: Omit<ScriptElement, "blanksBefore">[] = Array.from({ length: 26 }, (_, index) => ({
      type: "action" as const,
      text: `Line ${index}.`,
    }));
    elements.push({ type: "character", text: "BOB" }, { type: "parenthetical", text: "(quietly)" }, { type: "dialogue", text: "Hello." });
    const pages = paginate(document(elements));
    const cue = pages.findIndex((page) => page.some((line) => line.text === "BOB"));
    expect(cue).toBeGreaterThan(0);
    expect(pages[cue - 1].some((line) => line.text === "BOB")).toBe(false);
    expect(pages[cue].some((line) => line.text === "(quietly)")).toBe(true);
    expect(pages[cue].some((line) => line.text === "Hello.")).toBe(true);
  });

  it("starts later acts on a new page and maps source positions", () => {
    const script = document([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
      { type: "act", text: "ACT TWO" },
    ]);
    const pages = paginate(script);
    expect(pages).toHaveLength(2);
    expect(pages[1][0].text).toBe("ACT TWO");
    expect(pageStarts(pages)).toEqual([script.elements[2].from]);
    expect(pageAt(pages, script.elements[2].from)).toEqual({ page: 2, pages: 2 });
    expect(LINES_PER_PAGE).toBe(54);
  });

  it("moves dialogue that cannot start in the last line onto the next page", () => {
    const elements: Omit<ScriptElement, "blanksBefore">[] = Array.from({ length: 27 }, () => ({
      type: "action" as const,
      text: "A",
    }));
    elements.push({ type: "dialogue", text: "x".repeat(36) });
    const pages = paginate(document(elements));
    const speech = (page: { role: string; text: string }[]) =>
      page.filter((line) => line.role === "dialogue").map((line) => line.text).join("");
    expect(speech(pages[0])).toBe("");
    expect(pages[0].some((line) => line.text === "(MORE)")).toBe(false);
    expect(speech(pages[1])).toBe("x".repeat(36));
    expect(pages[1].some((line) => line.text === "(MORE)")).toBe(false);
  });

  it("splits an action that runs past the bottom of the page", () => {
    const pages = paginate(document([{ type: "action", text: "x".repeat(60 * 55) }]));
    expect(pages.map((page) => page.length)).toEqual([54, 1]);
    expect(pages[0].every((line) => line.text === "x".repeat(60))).toBe(true);
    expect(pages[1][0].text).toBe("x".repeat(60));
  });
});
