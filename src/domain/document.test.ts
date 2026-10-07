import { describe, expect, it } from "vitest";
import {
  editorDocument,
  elementAt,
  elementsDocument,
  isOpeningPlaceholder,
  lineAt,
  normalizeElements,
  snapshot,
  sourceLines,
  storableElements,
} from "./document";

describe("typed document", () => {
  it("keeps visible text separate from explicit element types", () => {
    const elements = normalizeElements([
      { type: "action", text: "INT. ROOM" },
      { type: "scene", text: "ordinary words" },
      { type: "dialogue", text: "@!~.#>\u200B" },
    ]);
    const editor = editorDocument(elements);
    expect(editor.text).toBe("INT. ROOM\n\nordinary words\n@!~.#>\u200B");
    expect(editor.lineTypes).toEqual(["action", null, "scene", "dialogue"]);
    expect(storableElements(snapshot(editor))).toEqual(elements);
  });

  it("represents an empty opening scene without a marker", () => {
    const document = elementsDocument([]);
    expect(document.text).toBe("");
    expect(document.lineTypes).toEqual(["scene"]);
    expect(storableElements(document)).toEqual([]);
  });

  it("rejects text and metadata with different line counts", () => {
    expect(() => snapshot({ text: "one\ntwo", lineTypes: ["action"] })).toThrow(/2 lines but 1 line types/);
  });

  it("stores one blank only after the first element, and keeps an explicit revision", () => {
    const opened = snapshot({ text: "\nHello\n\nthere", lineTypes: [null, "action", null, "dialogue"] }, 4);
    expect(opened.revision).toBe(4);
    expect(opened.elements.map((element) => element.blanksBefore)).toEqual([0, 1]);
    const fresh = snapshot({ text: "Hello", lineTypes: ["action"] });
    expect(fresh.revision).toBe(0);
    expect(fresh.elements[0].blanksBefore).toBe(0);
    const tight = snapshot({ text: "Hello\nthere", lineTypes: ["action", "dialogue"] });
    expect(tight.elements.map((element) => element.blanksBefore)).toEqual([0, 0]);
  });

  it("keeps the supplied blanks only after the first element", () => {
    expect(normalizeElements([
      { type: "scene", text: "", blanksBefore: 1 },
      { type: "action", text: "Go" },
      { type: "dialogue", text: "Hi", blanksBefore: 0 },
      { type: "action", text: "Stop", blanksBefore: 3 },
      { type: "action", text: "Once", blanksBefore: 1 },
    ]).map((element) => element.blanksBefore)).toEqual([0, 1, 0, 1, 1]);
  });

  it("treats only one empty scene as the opening placeholder", () => {
    const placeholder = elementsDocument([]);
    expect(placeholder.revision).toBe(0);
    expect(isOpeningPlaceholder(placeholder)).toBe(true);
    expect(elementsDocument([], 3).revision).toBe(3);
    const emptyAction = elementsDocument(normalizeElements([{ type: "action", text: "" }]));
    expect(isOpeningPlaceholder(emptyAction)).toBe(false);
    expect(storableElements(emptyAction)).toEqual([{ type: "action", text: "", blanksBefore: 0 }]);
    const continued = snapshot({ text: "\nGo", lineTypes: ["scene", "action"] });
    expect(isOpeningPlaceholder(continued)).toBe(false);
    expect(storableElements(continued).map((element) => element.text)).toEqual(["", "Go"]);
  });

  it("records each line's offsets, counting the newline between them", () => {
    const lines = sourceLines({ text: "Hello\nThere", lineTypes: ["action", "dialogue"] });
    expect(lines.map((line) => [line.from, line.to, line.text])).toEqual([
      [0, 5, "Hello"],
      [6, 11, "There"],
    ]);
  });

  it("returns the element whose range contains the cursor", () => {
    const document = elementsDocument(normalizeElements([
      { type: "action", text: "Hello" },
      { type: "scene", text: "ROOM" },
    ]));
    const [hello, room] = document.elements;
    expect(elementAt(document, hello.from)).toBe(hello);
    expect(elementAt(document, hello.to)).toBe(hello);
    expect(elementAt(document, room.from)).toBe(room);
    expect(elementAt(document, room.to)).toBe(room);
    expect(elementAt(document, hello.to + 1)).toBeNull();
    expect(elementAt(document, -1)).toBeNull();
    expect(elementAt(document, room.to + 1)).toBeNull();
  });

  it("clips a negative cursor to the first line and a cursor past the end to the last", () => {
    const document = { text: "\nNEXT", lineTypes: [null, "action"] as const };
    expect(lineAt(document, -1)).toMatchObject({ number: 0, text: "" });
    expect(lineAt(document, document.text.length + 5)).toMatchObject({ number: 1, text: "NEXT" });
    expect(lineAt(document, 0)).toMatchObject({ number: 0, text: "" });
  });
});
