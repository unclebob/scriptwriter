// @vitest-environment jsdom

import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elementsDocument, normalizeElements, type DocumentSnapshot } from "../domain/document";
import { derivationCount, resetDerivedCache } from "../projections/derived";
import {
  completionBounds,
  createEditor,
  elementLabel,
  findInScript,
  marginText,
  pageLabel,
  useElement,
  type ScriptEditor,
} from "./adapter";
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

  it("keeps the completion menu inside the window", () => {
    const windowBox = { top: 0, left: 0, bottom: 800, right: 1200 };
    expect(completionBounds(windowBox, { top: 90, left: 260, bottom: 740, right: 1100 })).toEqual({
      top: 90,
      left: 260,
      bottom: 740,
      right: 1100,
    });
    expect(completionBounds(windowBox, { top: -20, left: -10, bottom: 900, right: 1400 })).toEqual(windowBox);
    expect(completionBounds(windowBox, null)).toEqual(windowBox);
  });

  it("draws the completion menu outside the scrolling page", async () => {
    const stage = document.createElement("div");
    stage.className = "stage";
    document.body.append(stage);
    const editor = createEditor(
      stage,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "character", text: "B" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(editor.getDocument().elements[1].to);
    startCompletion(editor.view);
    await vi.waitFor(() => expect(completionStatus(editor.view.state)).toBe("active"));
    const menu = document.querySelector(".cm-tooltip-autocomplete");
    expect(menu).toBeTruthy();
    expect(stage.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    editor.view.destroy();
    stage.remove();
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeNull();
  });

  it("suggests a character name as it is typed", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hi." },
        { type: "character", text: "" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const cue = editor.getDocument().elements[2];
    typeText(editor, cue.from, "b");
    expect(editor.getDocument().elements[2].text).toBe("B");
    await vi.waitFor(() => expect(completionStatus(editor.view.state)).toBe("active"));
    const typed = editor.getDocument().elements[2];
    typeText(editor, typed.to, "o");
    expect(editor.getDocument().elements[2].text).toBe("BO");
    await vi.waitFor(() => expect(currentCompletions(editor.view.state).map((option) => option.label)).toEqual(["BOB"]));
    await new Promise((resolve) => setTimeout(resolve, 80));
    pressEnter(editor);
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "Hi." },
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "" },
    ]);
    parent.remove();
    editor.view.destroy();
  });

  it("suggests a scene heading as it is typed", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "KITCHEN" },
        { type: "action", text: "Bob waits." },
        { type: "scene", text: "STREET" },
        { type: "action", text: "Rain." },
        { type: "scene", text: "" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const heading = editor.getDocument().elements.at(-1)!;
    typeText(editor, heading.from, "k");
    expect(editor.getDocument().elements.at(-1)?.text).toBe("K");
    await vi.waitFor(() => expect(completionStatus(editor.view.state)).toBe("active"));
    expect(currentCompletions(editor.view.state).map((option) => option.label)).toEqual(["KITCHEN"]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    pressEnter(editor);
    const elements = editor.getDocument().elements.map(({ type, text }) => ({ type, text }));
    expect(elements.at(-1)).toEqual({ type: "scene", text: "KITCHEN" });
    expect(elements.filter((element) => element.type === "action").map((element) => element.text)).toEqual([
      "Bob waits.",
      "Rain.",
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
      const widget = value.spec.widget as {
        toDOM?: () => HTMLElement;
        ignoreEvent?: () => boolean;
        eq?: (other: object) => boolean;
      } | undefined;
      if (widget?.ignoreEvent && widget.eq) {
        expect(widget.ignoreEvent()).toBe(true);
        expect(widget.eq(widget)).toBe(true);
      }
      if (widget?.toDOM?.().className === "page-rule") marks.push(from);
    });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some((from) => from > dialogue.from && from < dialogue.to)).toBe(true);
    editor.view.destroy();
  });

  it("copies two elements and pastes them back as those elements", () => {
    const parent = document.createElement("div");
    const source = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hello." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    source.view.dispatch({ selection: { anchor: 0, head: source.view.state.doc.length } });
    const copied = dispatchClipboard(source, "copy", {});
    const mime = "application/x-scriptwriter-elements+json";
    const encoded = copied.clipboardData?.getData(mime) ?? "";
    expect(JSON.parse(encoded)).toEqual([
      { type: "character", text: "BOB", blanksBefore: 0 },
      { type: "dialogue", text: "Hello.", blanksBefore: 0 },
    ]);
    expect(copied.clipboardData?.getData("text/plain")).toBe(source.getDocument().text);
    source.view.dispatch({ selection: { anchor: 0, head: 0 } });
    expect(dispatchClipboard(source, "copy", {}).defaultPrevented).toBe(false);
    source.view.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(dispatchClipboard(source, "copy", {}).defaultPrevented).toBe(false);

    const target = createEditor(parent, [], { onChange: () => undefined, onCursor: () => undefined });
    dispatchClipboard(target, "paste", {
      [mime]: JSON.stringify([
        { type: "action", text: "Wait.", blanksBefore: 0 },
        { type: "action", text: "Go.", blanksBefore: 1 },
      ]),
      "text/plain": "Wait.\n\nGo.",
    });
    expect(target.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Wait." },
      { type: "action", text: "Go." },
    ]);
    source.view.destroy();
    target.view.destroy();
  });

  it("leaves the script unchanged when the clipboard is not a list of elements", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Stay." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const mime = "application/x-scriptwriter-elements+json";
    const before = editor.getDocument().text;
    const rejected = [
      "",
      "nope",
      "{}",
      "[null]",
      "[]",
      JSON.stringify([{ type: "nope", text: "Hi" }]),
      JSON.stringify([{ type: "action", text: "a\nb" }]),
    ];
    for (const encoded of rejected) {
      dispatchClipboard(editor, "paste", { [mime]: encoded, "text/plain": "" });
      expect(editor.getDocument().text).toBe(before);
    }
    const missing = new Event("paste", { bubbles: true, cancelable: true });
    editor.view.contentDOM.dispatchEvent(missing);
    expect(editor.getDocument().text).toBe(before);
    editor.view.destroy();
  });

  it("replaces the document, locks editing, and inserts an element above", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.setElements(normalizeElements([{ type: "character", text: "ANN" }]));
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "character", text: "ANN" });
    editor.setEditable(false);
    expect(editor.view.state.facet(EditorView.editable)).toBe(false);
    editor.setEditable(true);
    expect(editor.view.state.facet(EditorView.editable)).toBe(true);
    editor.insertBefore(editor.getDocument().elements[0].from);
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "character", text: "" },
      { type: "character", text: "ANN" },
    ]);
    editor.view.destroy();
  });

  it("opens an action on Return and cycles the type with Tab", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(editor.getDocument().elements[0].to);
    pressEnter(editor);
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Wait." },
      { type: "action", text: "" },
    ]);

    editor.setElements(normalizeElements([{ type: "action", text: "Wait." }]));
    editor.goto(editor.getDocument().elements[0].to);
    pressKey(editor, "Tab");
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "character", text: "WAIT." });
    pressKey(editor, "Tab", { shiftKey: true });
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "action", text: "WAIT." });
    pressKey(editor, "1", modifier());
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "scene", text: "WAIT." });
    parent.remove();
    editor.view.destroy();
  });

  it("accepts a character completion with Tab and stays in the cue", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hi." },
        { type: "character", text: "" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const cue = editor.getDocument().elements[2];
    typeText(editor, cue.from, "b");
    await vi.waitFor(() => expect(completionStatus(editor.view.state)).toBe("active"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    pressKey(editor, "Tab");
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "Hi." },
      { type: "character", text: "BOB" },
    ]);
    parent.remove();
    editor.view.destroy();
  });

  it("deletes a character inside an element and stops at the element edge", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "action", text: "Wait." },
        { type: "action", text: "Stay." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const first = editor.getDocument().elements[0];
    editor.goto(first.from + 1);
    pressKey(editor, "Backspace");
    expect(editor.getDocument().elements[0].text).toBe("ait.");
    editor.goto(editor.getDocument().elements[0].from);
    pressKey(editor, "Delete");
    expect(editor.getDocument().elements[0].text).toBe("it.");

    const edge = editor.getDocument().elements[0];
    editor.goto(edge.from);
    pressKey(editor, "Backspace");
    expect(editor.getDocument().elements[0].text).toBe("it.");
    editor.goto(editor.getDocument().elements[0].to);
    pressKey(editor, "Delete");
    expect(editor.getDocument().text).toBe("it.\n\nStay.");

    editor.setElements(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "" },
    ]));
    const empty = editor.getDocument().elements[1];
    editor.goto(empty.to);
    pressKey(editor, "Backspace");
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "ROOM" },
    ]);
    parent.remove();
    editor.view.destroy();
  });

  it("removes every element a selection covers", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hooks = { onChange: () => undefined, onCursor: () => undefined };
    const backspace = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      hooks,
    );
    backspace.goto(0);
    backspace.view.dispatch({ selection: { anchor: 0, head: backspace.view.state.doc.length } });
    pressKey(backspace, "Backspace");
    expect(backspace.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "" },
    ]);

    const deleted = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      hooks,
    );
    deleted.goto(0);
    deleted.view.dispatch({ selection: { anchor: 0, head: deleted.view.state.doc.length } });
    pressKey(deleted, "Delete");
    expect(deleted.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "" },
    ]);
    parent.remove();
    backspace.view.destroy();
    deleted.view.destroy();
  });

  it("does not join lines when a selection crosses a blank inside one element", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const action = editor.getDocument().elements[1];
    editor.goto(0);
    editor.view.dispatch({ selection: { anchor: 2, head: action.from } });
    pressKey(editor, "Backspace");
    expect(editor.getDocument().text).toBe("ROOM\n\nWait.");
    parent.remove();
    editor.view.destroy();
  });

  it("inserts a line break as action and deletes a selection that covers two elements", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Stay." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const at = editor.view.state.doc.length;
    editor.view.dispatch({
      changes: { from: at, insert: "\nNext." },
      annotations: Transaction.userEvent.of("input"),
    });
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Stay." },
      { type: "action", text: "Next." },
    ]);

    editor.setElements(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]));
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: "" },
      annotations: Transaction.userEvent.of("delete"),
    });
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "" },
    ]);
    editor.view.destroy();
  });

  it("widens a selection to the elements it touches", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hello." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const dialogue = editor.getDocument().elements[1];
    editor.view.dispatch({ selection: { anchor: 1, head: dialogue.from + 1 } });
    const selection = editor.view.state.selection.main;
    expect(selection.anchor).toBe(0);
    expect(selection.head).toBe(dialogue.to);
    editor.view.destroy();
  });

  it("names the element under the cursor and the page it is on", () => {
    const script = elementsDocument(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]));
    const blank = script.elements[0].to + 1;
    expect(elementLabel(script, script.elements[0].from)).toBe("Scene Heading");
    expect(marginText(script, script.elements[0].from)).toBe("Scene Heading");
    expect(elementLabel(script, blank)).toBe("Blank");
    expect(marginText(script, blank)).toBe("");
    expect(pageLabel(script, 0)).toBe("Page 1 of 1");
  });

  it("opens the find panel", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    findInScript(editor);
    expect(editor.view.dom.querySelector(".cm-search")).toBeTruthy();
    parent.remove();
    editor.view.destroy();
  });

  it("starts the caret inside a leading parenthetical", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "parenthetical", text: "(quietly)" }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    expect(editor.view.state.selection.main.head).toBe(1);
    editor.view.destroy();
  });

  it("leaves text typed during composition unchanged", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "character", text: "BOB" }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.view.dispatch({
      changes: { from: 0, to: 1, insert: "b" },
      annotations: Transaction.userEvent.of("input.compose"),
    });
    expect(editor.getDocument().text).toBe("bOB");
    editor.view.destroy();
  });

  it("rejects a replace or delete that would cross an element boundary", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const before = editor.getDocument().text;
    const action = editor.getDocument().elements[1];
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: "X" },
      annotations: Transaction.userEvent.of("input.replace"),
    });
    editor.view.dispatch({
      changes: { from: 2, to: action.from, insert: "" },
      annotations: Transaction.userEvent.of("delete"),
    });
    expect(editor.getDocument().text).toBe(before);
    editor.view.destroy();
  });

  it("ignores events on a scene number", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    let widgets = 0;
    editor.view.state.field(scriptDecorations).between(0, editor.view.state.doc.length, (_from, _to, value) => {
      const widget = value.spec.widget as { ignoreEvent: () => boolean; eq: (other: object) => boolean } | undefined;
      if (!widget) return;
      widgets += 1;
      expect(widget.ignoreEvent()).toBe(true);
      expect(widget.eq(widget)).toBe(true);
    });
    expect(widgets).toBeGreaterThan(0);
    editor.view.destroy();
  });
});

function typeText(editor: ScriptEditor, at: number, text: string) {
  editor.view.dispatch({
    changes: { from: at, to: at, insert: text },
    selection: { anchor: at + text.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
}

function dispatchClipboard(
  editor: ScriptEditor,
  type: "copy" | "paste",
  values: Record<string, string>,
): Event & { clipboardData: { getData: (mime: string) => string } } {
  const stored = new Map(Object.entries(values));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      getData: (mime: string) => stored.get(mime) ?? "",
      setData: (mime: string, value: string) => {
        stored.set(mime, value);
      },
    },
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event as Event & { clipboardData: { getData: (mime: string) => string } };
}

function pressEnter(editor: ScriptEditor) {
  pressKey(editor, "Enter");
}

function pressKey(editor: ScriptEditor, key: string, extras: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { ...extras, key, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
}

function modifier(): KeyboardEventInit {
  return /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
}
