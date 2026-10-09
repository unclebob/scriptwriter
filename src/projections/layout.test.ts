import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements, type ScriptElement } from "../domain/document";
import { LINES_PER_PAGE, pageAt, pageStarts, paginate, withContd, wrapText, type Placed } from "./layout";

function document(elements: readonly Omit<ScriptElement, "blanksBefore">[]) {
  return elementsDocument(normalizeElements(elements));
}

function documentWithBlanks(elements: readonly { type: ScriptElement["type"]; text: string; blanksBefore: number }[]) {
  let from = 0;
  const positioned = elements.map((element, index) => {
    const item = {
      type: element.type,
      text: element.text,
      blanksBefore: element.blanksBefore as 0 | 1,
      index,
      line: index,
      from,
      to: from + element.text.length,
    };
    from += element.text.length + 1;
    return item;
  });
  return { text: elements.map((element) => element.text).join("\n"), lineTypes: elements.map((element) => element.type), revision: 0, elements: positioned };
}

describe("pagination", () => {
  it("wraps text at the element width", () => {
    expect(wrapText("one two three four", 8)).toEqual(["one two", "three", "four"]);
    expect(wrapText("abc def", 7)).toEqual(["abc def"]);
    expect(wrapText("abc def", 6)).toEqual(["abc", "def"]);
    expect(wrapText("superduper", 5)).toEqual(["super", "duper"]);
    expect(wrapText("ab ", 2)).toEqual(["ab"]);
    expect(wrapText("a", 8)).toEqual(["a"]);
    expect(wrapText("", 8)).toEqual([""]);
    expect(wrapText(" ", 4)).toEqual([""]);
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
    expect(pages[heading][0].text).toBe("ROOM");
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
    expect(pages[1][0].source).toBe(pages[1][1].source);
    expect(pageAt(pages, pages[1][0].source ?? -1)).toEqual({ page: 2, pages: pages.length });
    expect(pageAt(pages, -1)).toEqual({ page: 1, pages: pages.length });
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

  it("keeps an opening act on the first page", () => {
    const pages = paginate(document([
      { type: "act", text: "ACT ONE" },
      { type: "scene", text: "ROOM" },
    ]));
    expect(pages).toHaveLength(1);
    expect(pages[0].map((line) => line.text)).toEqual(["ACT ONE", "", "ROOM"]);
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

  it("keeps the blank before a scene that fits on the page", () => {
    const pages = paginate(document([
      { type: "action", text: "Hi." },
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Bob enters." },
    ]));
    expect(pages[0].map((line) => line.text)).toEqual(["Hi.", "", "ROOM", "", "Bob enters."]);
  });

  it("starts an act on the next page when the page has one line", () => {
    const pages = paginate(document([
      { type: "action", text: "Hi." },
      { type: "act", text: "ACT TWO" },
    ]));
    expect(pages.map((page) => page.map((line) => line.text))).toEqual([["Hi."], ["ACT TWO"]]);
    expect(pageAt(pages, 0)).toEqual({ page: 1, pages: 2 });
  });

  it("keeps a shot heading with what follows", () => {
    const elements: Omit<ScriptElement, "blanksBefore">[] = Array.from({ length: 53 }, (_, index) => ({
      type: "action" as const,
      text: `Line ${index}.`,
    }));
    elements.push({ type: "shot", text: "WIDE" });
    elements.push({ type: "action", text: "Bob enters." });
    const pages = paginate(document(elements));
    const shot = pages.findIndex((page) => page.some((line) => line.text === "WIDE"));
    expect(shot).toBeGreaterThan(0);
    expect(pages[shot][0].text).toBe("WIDE");
    expect(pages[shot].some((line) => line.text === "Bob enters.")).toBe(true);
  });

  it("keeps a scene when it and the next two lines fill the page exactly", () => {
    const pages = paginate(document([
      { type: "action", text: "a".repeat(60 * 50) },
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Bob." },
    ]));
    expect(pages).toHaveLength(1);
    expect(pages[0].some((line) => line.text === "ROOM")).toBe(true);
    expect(pages[0].at(-1)?.text).toBe("Bob.");
  });

  it("moves a scene with a cue that would fill the next page exactly", () => {
    const pages = paginate(document([
      { type: "action", text: "Hi." },
      { type: "scene", text: "ROOM" },
      { type: "character", text: "C".repeat(38 * 51) },
    ]));
    expect(pages[0].map((line) => line.text)).toEqual(["Hi."]);
    expect(pages[1][0].text).toBe("ROOM");
    expect(pages[1].some((line) => line.role === "character")).toBe(true);
  });

  it("leaves a scene in place when the following act is taller than a page", () => {
    const pages = paginate(document([
      { type: "action", text: "a".repeat(60 * 52) },
      { type: "scene", text: "ROOM" },
      { type: "act", text: "y".repeat(60 * 52) },
    ]));
    expect(pages[0].at(-1)?.text).toBe("ROOM");
    expect(pages[1][0].role).toBe("act");
  });

  it("splits a character cue that has nothing after it", () => {
    const pages = paginate(document([
      { type: "action", text: "x".repeat(60 * 50) },
      { type: "character", text: "C".repeat(38 * 5) },
    ]));
    expect(pages[0].some((line) => line.role === "character")).toBe(true);
    expect(pages[1][0].role).toBe("character");
  });

  it("does not continue a speech that fits under its cue", () => {
    const pages = paginate(document([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "Hello." },
    ]));
    expect(pages[0].map((line) => line.text)).toEqual(["BOB", "Hello."]);
  });

  it("does not break dialogue that fills a page exactly", () => {
    const pages = paginate(document([{ type: "dialogue", text: "x".repeat(35 * 54) }]));
    expect(pages).toHaveLength(1);
    expect(pages[0].some((line) => line.text === "(MORE)")).toBe(false);
  });

  it("fills later dialogue pages without running past the bottom", () => {
    const pages = paginate(document([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "x".repeat(35 * (54 + 53 + 10)) },
    ]));
    expect(pages[0]).toHaveLength(54);
    expect(pages[1]).toHaveLength(54);
    expect(pages[1][0].text).toBe("BOB (CONT'D)");
    expect(pages.every((page) => page.length <= LINES_PER_PAGE)).toBe(true);
  });

  it("puts one dialogue line and (MORE) in the last two lines", () => {
    const script = document([
      { type: "action", text: "a".repeat(60 * 52) },
      { type: "dialogue", text: "x".repeat(35 * 3) },
    ]);
    const pages = paginate(script);
    const spoken = pages[0].filter((line) => line.role === "dialogue");
    expect(spoken).toHaveLength(1);
    expect(spoken[0].source).toBe(script.elements[1].from);
    expect(pages[0].at(-1)?.text).toBe("(MORE)");
  });

  it("records the source of each dialogue line kept above (MORE)", () => {
    const script = document([
      { type: "action", text: "a".repeat(60 * 51) },
      { type: "dialogue", text: "x".repeat(35 * 4) },
    ]);
    const pages = paginate(script);
    const spoken = pages[0].filter((line) => line.role === "dialogue");
    expect(spoken.map((line) => line.source)).toEqual([script.elements[1].from, script.elements[1].from + 35]);
    expect(pages[1][0].source).toBe(pages[1][1].source);
  });

  it("keeps the first line of a parenthetical in the last line of the page", () => {
    const pages = paginate(document([
      { type: "action", text: "a".repeat(60 * 53) },
      { type: "parenthetical", text: "p".repeat(25 * 2) },
    ]));
    expect(pages[0].at(-1)?.role).toBe("parenthetical");
    expect(pages[1][0].role).toBe("parenthetical");
  });

  it("drops a blank that would otherwise open the next page", () => {
    const pages = paginate(document([
      { type: "action", text: "a".repeat(60 * 54) },
      { type: "action", text: "Next." },
    ]));
    expect(pages[0]).toHaveLength(54);
    expect(pages[1].map((line) => line.text)).toEqual(["Next."]);
  });

  it("carries an action that starts on a full page onto the next page", () => {
    const pages = paginate(document([
      { type: "action", text: "a".repeat(60 * 53) },
      { type: "action", text: "Hello there." },
    ]));
    expect(pages[0]).toHaveLength(54);
    expect(pages[0].at(-1)?.role).toBe("blank");
    expect(pages[1].map((line) => line.text)).toEqual(["Hello there."]);
  });

  it("keeps the source of an action continued on the next page", () => {
    const script = document([
      { type: "action", text: "a".repeat(60 * 50) },
      { type: "action", text: "b".repeat(60 * 5) },
    ]);
    const pages = paginate(script);
    const continued = pages[0].find((line) => line.text.startsWith("b"));
    expect(continued?.source).toBe(script.elements[1].from);
    expect(pages[1][0].text.startsWith("b")).toBe(true);
  });

  it("does not put a blank line at the top of a continued action", () => {
    const pages = paginate(document([
      { type: "action", text: "Hi." },
      { type: "action", text: "b".repeat(60 * 54) },
    ]));
    expect(pages[1][0].text).toBe("b".repeat(60));
  });

  it("gives a wrapped line the source after the separating space", () => {
    const pages = paginate(document([{ type: "action", text: `${"x".repeat(60)} y` }]));
    expect(pages[0][1].source).toBe(61);
  });

  it("fills two full pages of action", () => {
    const pages = paginate(document([{ type: "action", text: "x".repeat(60 * 108) }]));
    expect(pages.map((page) => page.length)).toEqual([54, 54]);
  });

  it("stops a run of blank lines at the bottom margin", () => {
    const pages = paginate(documentWithBlanks([
      { type: "action", text: "z".repeat(60 * 10), blanksBefore: 0 },
      { type: "action", text: "Tail", blanksBefore: 55 },
    ]));
    expect(pages[0]).toHaveLength(54);
    expect(pages[1].map((line) => line.text)).toEqual(["Tail"]);
  });

  it("maps positions that are not on a sourced line", () => {
    const later: Placed[][] = [
      [{ text: "later", role: "action", source: 5 }],
      [{ text: "earlier", role: "action", source: 0 }],
    ];
    const negative: Placed[][] = [
      [{ text: "a", role: "action", source: 10 }],
      [{ text: "b", role: "action", source: -1 }],
    ];
    const skipped: Placed[][] = [
      [{ text: "a", role: "action", source: 5 }],
      [{ text: "b", role: "action", source: 3 }],
    ];
    const blank: Placed[][] = [
      [{ text: "Hi.", role: "action", source: 0 }],
      [{ text: "", role: "blank" }],
    ];
    const future: Placed[][] = [
      [{ text: "a", role: "action", source: 0 }],
      [{ text: "b", role: "action", source: 10 }],
    ];
    const between: Placed[][] = [
      [{ text: "Hi.", role: "action", source: 0 }],
      [{ text: "", role: "blank" }],
      [{ text: "Next", role: "action", source: 4 }],
    ];
    expect(pageAt([], 0)).toEqual({ page: 1, pages: 1 });
    expect(pageAt(later, 0)).toEqual({ page: 2, pages: 2 });
    expect(pageAt(negative, -1)).toEqual({ page: 2, pages: 2 });
    expect(pageAt(skipped, 5)).toEqual({ page: 1, pages: 2 });
    expect(pageAt(blank, 0)).toEqual({ page: 1, pages: 2 });
    expect(pageAt(future, 0)).toEqual({ page: 1, pages: 2 });
    expect(pageStarts(blank)).toEqual([]);
    expect(pageStarts(between)).toEqual([4]);
  });
});
