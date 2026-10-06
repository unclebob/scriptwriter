import { describe, expect, it } from "vitest";
import { normalizeElements } from "./document";
import { parseScriptJson, serializeScript, storedScript } from "./script";

describe("script JSON", () => {
  it("round-trips every typed element and exact text", () => {
    const elements = normalizeElements([
      { type: "action", text: "!Bang" },
      { type: "scene", text: ".Room" },
      { type: "act", text: "#Prologue" },
      { type: "dialogue", text: "@ ~ > \u200B café 漢字" },
    ]);
    const text = serializeScript({
      title: 'The "Kettle"',
      credit: "Written by",
      author: "A. Writer",
      draft: "October 2026",
      contact: "writer@example.com",
      elements,
    });
    const loaded = storedScript("/script", text);
    expect(loaded.elements).toEqual(elements);
    expect(loaded.title).toBe('The "Kettle"');
  });

  it("loads a missing file as an empty script", () => {
    const loaded = storedScript("/script", null);
    expect(loaded.elements).toEqual([]);
    expect(loaded.warnings).toEqual(["This folder has no script.json. The title page is empty."]);
  });

  it("does not store the editor's empty opening scene", () => {
    const text = serializeScript({
      title: "",
      credit: "Written by",
      author: "",
      draft: "",
      contact: "",
      elements: [{ type: "scene", text: "", blanksBefore: 0 }],
    });
    expect(parseScriptJson(text).elements).toEqual([]);
  });

  it("validates the storage boundary", () => {
    expect(() => parseScriptJson("{")).toThrow(/not JSON/);
    expect(() => parseScriptJson("[]")).toThrow(/not an object/);
    expect(() => parseScriptJson('{"elements":[{"type":"note","text":"Hi"}]}')).toThrow(/unknown type/);
    expect(() => parseScriptJson('{"elements":[{"type":"action","text":"a\\nb"}]}')).toThrow(/more than one line/);
    expect(() => parseScriptJson('{"title":"A\\nB"}')).toThrow(/title is more than one line/);
    expect(parseScriptJson('{"contact":"A\\nB"}').contact).toBe("A\nB");
    expect(() => parseScriptJson('{"elements":[{"type":"action","text":"Hi","blanksBefore":-1}]}')).toThrow(
      /bad blanksBefore/,
    );
  });
});
