import { describe, expect, it } from "vitest";
import { LINES_PER_PAGE, pageAt, pageStarts, paginate, withContd, wrapText } from "./layout";

describe("pagination", () => {
  it("wraps dialogue to 35 characters", () => {
    expect(wrapText("one two three four", 8)).toEqual(["one two", "three", "four"]);
    expect(wrapText("superduper", 5)).toEqual(["super", "duper"]);
  });

  it("drops the blank lines at the top of a page", () => {
    const doc = "CUT TO:\n\n\nINT. HALL - DAY\n\nBob enters.";
    const pages = paginate(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0][0].text).toBe("CUT TO:");
    expect(pages[0].filter((line) => line.text === "INT. HALL - DAY").length).toBe(1);
  });

  it("keeps one blank line between a heading and the action", () => {
    const pages = paginate("INT. HALL - DAY\n\nBob enters.");
    expect(pages[0].map((line) => line.text)).toEqual(["INT. HALL - DAY", "", "Bob enters."]);
  });

  it("moves a scene heading that would sit alone at the bottom", () => {
    const filler = Array.from({ length: 51 }, (_, index) => `Line ${index}.`).join("\n\n");
    const doc = `${filler}\n\n\nINT. HALL - DAY\n\nBob enters.`;
    const pages = paginate(doc);
    expect(pages.length).toBeGreaterThan(1);
    const headingPage = pages.findIndex((page) => page.some((line) => line.text === "INT. HALL - DAY"));
    const actionPage = pages.findIndex((page) => page.some((line) => line.text === "Bob enters."));
    expect(headingPage).toBe(actionPage);
    expect(headingPage).toBeGreaterThan(0);
  });

  it("moves a heading off a page that has no room for it and the next line", () => {
    const filler = Array.from({ length: 53 }, (_, index) => `Line ${index}.`).join("\n");
    const doc = `${filler}\n\nINT. HALL - DAY\n\nBob enters.`;
    const pages = paginate(doc);
    const headingPage = pages.findIndex((page) => page.some((line) => line.text === "INT. HALL - DAY"));
    expect(headingPage).toBeGreaterThan(0);
    expect(pages[headingPage - 1].at(-1)?.text).toBe("Line 52.");
    expect(pages[headingPage][0].text).toBe("INT. HALL - DAY");
    expect(pages[headingPage].some((line) => line.text === "Bob enters.")).toBe(true);
  });

  it("drops blank lines that do not fit at the bottom of a page", () => {
    const filler = Array.from({ length: 53 }, (_, index) => `Line ${index}.`).join("\n");
    const doc = `${filler}\n\n\n\nBob enters.`;
    const pages = paginate(doc);
    const actionPage = pages.findIndex((page) => page.some((line) => line.text === "Bob enters."));
    expect(actionPage).toBeGreaterThan(0);
    expect(pages[actionPage][0].text).toBe("Bob enters.");
  });

  it("keeps a speech that starts with no room for (MORE)", () => {
    const filler = Array.from({ length: 53 }, (_, index) => `Line ${index}.`).join("\n");
    const speech = "word ".repeat(30).trim();
    const pages = paginate(`${filler}\n\u200B${speech}`);
    const spoken = pages.flat().filter((line) => line.role === "dialogue").map((line) => line.text).join(" ");
    expect(spoken).toBe(speech);
    const packed = pages.findIndex((page) => page.some((line) => line.text === "Line 52."));
    expect(pages[packed].some((line) => line.role === "dialogue")).toBe(false);
  });

  it("breaks a speech that has room for one line and (MORE)", () => {
    const filler = Array.from({ length: 52 }, (_, index) => `Line ${index}.`).join("\n");
    const speech = "word ".repeat(30).trim();
    const pages = paginate(`${filler}\n\u200B${speech}`);
    const packed = pages.findIndex((page) => page.some((line) => line.text === "Line 51."));
    expect(pages[packed].at(-1)?.text).toBe("(MORE)");
    const spoken = pages.flat().filter((line) => line.role === "dialogue").map((line) => line.text).join(" ");
    expect(spoken).toBe(speech);
  });

  it("carries the rest of an action onto the next page", () => {
    const filler = Array.from({ length: 50 }, (_, index) => `Line ${index}.`).join("\n");
    const action = "word ".repeat(80).trim();
    const doc = `${filler}\n${action}`;
    const pages = paginate(doc);
    const carried = pages.flat().filter((line) => line.text.startsWith("word"));
    expect(carried.map((line) => line.text).join(" ")).toBe(action);
    expect(pages.length).toBeGreaterThan(1);
    expect(carried[0]?.source).toBe(doc.indexOf(action));
  });

  it("ends a broken speech with (MORE) and starts the next page with (CONT'D)", () => {
    const speech = "word ".repeat(500).trim();
    const doc = `@BOB\n${speech}`;
    const pages = paginate(doc);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].at(-1)?.text).toBe("(MORE)");
    expect(pages[1][0].text).toBe("BOB (CONT'D)");
    expect(pages[1].some((line) => line.text === "(MORE)")).toBe(false);
    const spoken = pages.flat().filter((line) => line.role === "dialogue").map((line) => line.text).join(" ");
    expect(spoken).toBe(speech);
  });

  it("does not add a second (CONT'D)", () => {
    expect(withContd("BOB (CONT'D)")).toBe("BOB (CONT'D)");
    expect(withContd("BOB (V.O.)")).toBe("BOB (V.O.) (CONT'D)");
  });

  it("starts an act on a new page unless the page is empty", () => {
    const opening = "ACT ONE\n\n\nINT. HALL - DAY";
    const first = paginate(opening);
    expect(first).toHaveLength(1);
    expect(first[0][0].text).toBe("ACT ONE");
    expect(pageStarts(opening)).toEqual([]);

    const laterDoc = "INT. HALL - DAY\n\nBob enters.\n\n\nACT TWO";
    const later = paginate(laterDoc);
    expect(later).toHaveLength(2);
    expect(later[0].some((line) => line.text === "ACT TWO")).toBe(false);
    expect(later[1][0].text).toBe("ACT TWO");
    expect(pageStarts(laterDoc)).toEqual([laterDoc.indexOf("ACT TWO")]);

    const full = Array.from({ length: LINES_PER_PAGE }, (_, index) => `Line ${index}.`).join("\n");
    const fullDoc = `${full}\n\n\nACT TWO`;
    const packed = paginate(fullDoc);
    expect(packed).toHaveLength(2);
    expect(packed[0]).toHaveLength(LINES_PER_PAGE);
    expect(packed[1][0].text).toBe("ACT TWO");
  });

  it("reports the page the cursor is on", () => {
    const doc = Array.from({ length: 80 }, (_, index) => `Line ${index}.`).join("\n\n");
    const at = pageAt(doc, 0);
    expect(at.pages).toBeGreaterThan(1);
    expect(at.page).toBe(1);
    expect(pageAt(doc, doc.length).page).toBe(at.pages);
    expect(LINES_PER_PAGE).toBe(54);
  });
});
