import { describe, expect, it } from "vitest";
import { LINES_PER_PAGE, pageAt, pageStarts, paginate, withContd, wrapText } from "./layout";

describe("pagination", () => {
  it("wraps dialogue to 35 characters", () => {
    expect(wrapText("one two three four", 8)).toEqual(["one two", "three", "four"]);
  });

  it("drops the blank lines at the top of a page", () => {
    const doc = "CUT TO:\n\n\nINT. HALL - DAY\n\nBob enters.";
    const pages = paginate(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0][0].text).toBe("CUT TO:");
    expect(pages[0].filter((line) => line.text === "INT. HALL - DAY").length).toBe(1);
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
