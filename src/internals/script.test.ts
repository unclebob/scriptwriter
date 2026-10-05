import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nodeFs } from "../nodeFs";
import { parseScript } from "./fountain";
import { docFromElements, elementsFromDoc, loadScript, parseScriptJson, saveScript, serializeScript } from "./script";

describe("script folder", () => {
  it("round-trips the title page and the elements", () => {
    const doc = "ACT I\n\n.KITCHEN\n\n@ALICE\nWow.\n\n!BOOM.";
    const text = serializeScript({
      title: 'The "Kettle"',
      credit: "Written by",
      author: "A. Writer",
      draft: "October 2026",
      contact: "A. Writer\nwriter@example.com",
      body: doc,
    });
    const file = parseScriptJson(text);
    expect(file.title).toBe('The "Kettle"');
    expect(file.contact).toBe("A. Writer\nwriter@example.com");
    expect(JSON.parse(text).comment).toBeUndefined();
    expect(docFromElements(file.elements)).toBe(doc);
    expect(elementsFromDoc(doc).map((element) => element.type)).toEqual(["act", "scene", "character", "dialogue", "action"]);
  });

  it("keeps a missing blank and reads a larger gap as one", () => {
    const tight = "INT. HALL - DAY\nBob waits.\n\n\u200BHello.";
    expect(docFromElements(elementsFromDoc(tight))).toBe(tight);
    expect(parseScript(tight).map((element) => element.type)).toEqual(["scene", "action", "dialogue"]);
    const wide = "INT. HALL - DAY\n\n\n\nBob waits.";
    expect(docFromElements(elementsFromDoc(wide))).toBe("INT. HALL - DAY\n\nBob waits.");
    const read = parseScriptJson('{"elements":[{"type":"scene","text":"HALL"},{"type":"action","text":"Hi","blanksBefore":4}]}');
    expect(read.elements[1].blanksBefore).toBe(1);
  });

  it("does not write the empty scene heading that opens a new script", () => {
    const text = serializeScript({ title: "", credit: "Written by", author: "", draft: "", contact: "", body: "." });
    expect(parseScriptJson(text).elements).toEqual([]);
    expect(docFromElements([])).toBe("");
  });

  it("loads an empty folder as an empty script and saves script.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "scriptwriter-"));
    try {
      const fs = nodeFs();
      const loaded = await loadScript(fs, root);
      expect(loaded.title).toBe("");
      expect(loaded.credit).toBe("Written by");
      expect(loaded.warnings).toEqual(["This folder has no script.json. The title page is empty."]);
      loaded.title = "The Kettle";
      loaded.body = "INT. KITCHEN - DAY\n\nBob waits.";
      await saveScript(fs, loaded);
      const again = await loadScript(fs, root);
      expect(again.title).toBe("The Kettle");
      expect(again.body).toBe("INT. KITCHEN - DAY\n\nBob waits.");
      expect(again.warnings).toEqual([]);
      expect(parseScript(again.body).map((element) => element.text)).toEqual(["INT. KITCHEN - DAY", "Bob waits."]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a file that is not the script object", () => {
    expect(() => parseScriptJson("{")).toThrow(/not JSON/);
    expect(() => parseScriptJson("[]")).toThrow(/not an object/);
    expect(() => parseScriptJson('{"elements":[{"type":"note","text":"Hi"}]}')).toThrow(/unknown type/);
  });

  it("loads the sample script shipped with the app", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../spec-script");
    const loaded = await loadScript(nodeFs(), root);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.title).toBe("The Kettle");
    expect(loaded.credit).toBe("Written by");
    expect(loaded.author).toBe("A. Writer");
    expect(loaded.draft).toBe("October 2026");
    expect(loaded.contact).toBe("A. Writer\nwriter@example.com");
    const elements = parseScript(loaded.body);
    expect(elements.some((element) => element.type === "scene" && element.text === "KITCHEN")).toBe(true);
    expect(elements.some((element) => element.text === "Wow.")).toBe(true);
    expect(elements.some((element) => element.text === "INT. KITCHEN - DA")).toBe(true);
  });
});
