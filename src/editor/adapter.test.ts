// @vitest-environment jsdom

import { startCompletion, completionStatus } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeElements, type DocumentSnapshot } from "../domain/document";
import { derivationCount, resetDerivedCache } from "../projections/derived";
import { createEditor, useElement } from "./adapter";
import { scriptDecorations } from "./decorations";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const empty = () => {
    const list = [] as unknown as DOMRectList;
    list.item = () => null;
    return list;
  };
  Range.prototype.getClientRects = empty;
  Range.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() { return {}; },
  });
});

describe("CodeMirror typed adapter", () => {
  it("keeps marker-like content visible and does not infer scene types", () => {
    const changes: DocumentSnapshot[] = [];
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "@!~.#>\u200B INT. ROOM" }]),
      { onChange: (value) => changes.push(value), onCursor: () => undefined },
    );
    expect(editor.view.state.doc.toString()).toBe("@!~.#>\u200B INT. ROOM");
    expect(editor.getDocument().elements[0].type).toBe("action");
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: " EXT." },
      annotations: Transaction.userEvent.of("input.type"),
    });
    expect(editor.getDocument().elements[0].type).toBe("action");
    expect(changes.at(-1)?.elements[0].text).toContain("EXT.");
    editor.view.destroy();
  });

  it("undoes and redoes element metadata with text", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "quietly" }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    useElement(editor, "parenthetical");
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "parenthetical", text: "(quietly)" });
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "action", text: "quietly" });
    expect(redo(editor.view)).toBe(true);
    expect(editor.getDocument().elements[0].type).toBe("parenthetical");
    editor.view.destroy();
  });

  it("does not rederive pagination for cursor-only transactions", () => {
    resetDerivedCache();
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const created = derivationCount();
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    expect(derivationCount()).toBe(created);
    editor.view.destroy();
  });

  it("replaces every match without inventing action lines", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const scene = editor.getDocument().elements[0];
    editor.view.dispatch({
      changes: { from: scene.from, to: scene.to, insert: "ROOM\nNEXT" },
      annotations: Transaction.userEvent.of("input.replace"),
    });
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "ROOM" },
      { type: "scene", text: "NEXT" },
      { type: "action", text: "Wait." },
    ]);
    editor.view.destroy();
  });

  it("formats every scene heading in a replace-all", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "scene", text: "HALL" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const [room, hall] = editor.getDocument().elements;
    editor.view.dispatch({
      changes: [
        { from: room.from, to: room.to, insert: "kitchen" },
        { from: hall.from, to: hall.to, insert: "porch" },
      ],
      annotations: Transaction.userEvent.of("input.replace.all"),
    });
    expect(editor.getDocument().elements.map((element) => element.text)).toEqual(["KITCHEN", "PORCH"]);
    editor.view.destroy();
  });

  it("opens dialogue after Return accepts a character completion", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hi." },
        { type: "character", text: "B" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const cue = editor.getDocument().elements[2];
    editor.goto(cue.to);
    startCompletion(editor.view);
    await vi.waitFor(() => expect(completionStatus(editor.view.state)).toBe("active"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
    editor.view.contentDOM.dispatchEvent(event);
    const elements = editor.getDocument().elements.map(({ type, text }) => ({ type, text }));
    expect(elements).toEqual([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "Hi." },
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "" },
    ]);
    parent.remove();
    editor.view.destroy();
  });

  it("marks a page break at the source offset, not the start of the element", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "word ".repeat(400).trim() },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const dialogue = editor.getDocument().elements[1];
    const marks: number[] = [];
    editor.view.state.field(scriptDecorations).between(0, editor.view.state.doc.length, (from, _to, value) => {
      const widget = value.spec.widget as { toDOM?: () => HTMLElement } | undefined;
      if (widget?.toDOM?.().className === "page-rule") marks.push(from);
    });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some((from) => from > dialogue.from && from < dialogue.to)).toBe(true);
    editor.view.destroy();
  });
});
