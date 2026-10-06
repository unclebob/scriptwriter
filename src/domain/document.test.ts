import { describe, expect, it } from "vitest";
import { editorDocument, elementsDocument, normalizeElements, snapshot, storableElements } from "./document";

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
});
