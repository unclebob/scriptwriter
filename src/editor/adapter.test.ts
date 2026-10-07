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
  completionTooltipSpace,
  createEditor,
  keepCaretInView,
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
    expect(copied.defaultPrevented).toBe(true);
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
      JSON.stringify([{ type: "action", text: ["Hi"] }]),
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
    expect(editor.view.state.facet(EditorView.editable)).toBe(true);
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
    const tab = pressKey(editor, "Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "character", text: "WAIT." });
    const shift = pressKey(editor, "Tab", { shiftKey: true });
    expect(shift.defaultPrevented).toBe(true);
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "action", text: "WAIT." });
    const numbered = pressKey(editor, "1", modifier());
    expect(numbered.defaultPrevented).toBe(true);
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
    const tab = pressKey(editor, "Tab");
    expect(tab.defaultPrevented).toBe(true);
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
    expect(scrollTarget(editor)).toBeTruthy();

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
    expect(editor.view.state.selection.main.head).toBe(0);
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
    expect(scrollTarget(editor)).toBeTruthy();
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

  it("scrolls a clipped caret into view", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(100);
    expect(editor.view.state.selection.main.head).toBe(editor.view.state.doc.length);
    expect(scrollTarget(editor)).toBeTruthy();
    editor.goto(-3);
    expect(editor.view.state.selection.main.head).toBe(0);
    editor.view.destroy();
  });

  it("does not scroll when the caret has no place on screen", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    expect(editor.view.state.facet(EditorView.cursorScrollMargin)).toEqual({ x: 5, y: 16 });
    const handler = editor.view.state.facet(EditorView.scrollHandler)[0];
    expect(
      handler(editor.view, editor.view.state.selection.main, { x: "nearest", y: "nearest", xMargin: 5, yMargin: 16 }),
    ).toBe(false);
    editor.view.destroy();
  });

  it("scrolls the page to keep the caret on screen", () => {
    const stage = fakePort("auto", "auto", { top: 0, left: 0, bottom: 100, right: 200 });
    const page = fakePort("visible", "visible", { top: 0, left: 0, bottom: 400, right: 200 });
    const start = mountPorts([stage, page]);
    const below = { top: 114, left: 10, bottom: 130, right: 18 };
    expect(keepCaretInView(start, below, 0, 0, 1)).toBe(true);
    expect(stage.scrollTop).toBe(30);
    expect(stage.scrollLeft).toBe(0);
    expect(page.scrollTop).toBe(0);

    stage.scrollTop = 0;
    const above = { top: -20, left: 10, bottom: -4, right: 18 };
    keepCaretInView(start, above, 4, 8, 1);
    expect(stage.scrollTop).toBe(-28);

    stage.scrollTop = 0;
    const inside = { top: 40, left: 10, bottom: 56, right: 18 };
    keepCaretInView(start, inside, 8, 8, 1);
    expect(stage.scrollTop).toBe(0);

    stage.scrollTop = 0;
    const nearTop = { top: 2, left: 10, bottom: 18, right: 18 };
    keepCaretInView(start, nearTop, 0, 8, 1);
    expect(stage.scrollTop).toBe(-6);
    start.parentElement?.parentElement?.remove();
  });

  it("scrolls sideways and through a chain of scrollports", () => {
    const stage = fakePort("hidden", "auto", { top: 0, left: 0, bottom: 80, right: 200 });
    const wide = fakePort("auto", "hidden", { top: 0, left: 0, bottom: 100, right: 200 });
    const start = mountPorts([stage, wide]);
    const corner = { top: 114, left: 220, bottom: 130, right: 240 };
    keepCaretInView(start, corner, 4, 0, 1);
    expect(wide.scrollLeft).toBe(44);
    expect(wide.scrollTop).toBe(30);
    expect(stage.scrollTop).toBe(20);
    expect(stage.scrollLeft).toBe(0);

    wide.scrollLeft = 40;
    const offLeft = { top: 20, left: -30, bottom: 36, right: -10 };
    keepCaretInView(start, offLeft, 4, 0, -1);
    expect(wide.scrollLeft).toBe(6);
    start.parentElement?.parentElement?.remove();
  });

  it("keeps the near edge of a caret taller than the page", () => {
    const stage = fakePort("scroll", "scroll", { top: 10, left: 0, bottom: 110, right: 200 });
    const start = mountPorts([stage]);
    keepCaretInView(start, { top: 0, left: 0, bottom: 250, right: 10 }, 0, 0, 1);
    expect(stage.scrollTop).toBe(140);

    stage.scrollTop = 0;
    keepCaretInView(start, { top: -20, left: 0, bottom: -4, right: 10 }, 0, 0, -1);
    expect(stage.scrollTop).toBe(-30);

    stage.scrollTop = 0;
    keepCaretInView(start, { top: 20, left: 0, bottom: 190, right: 10 }, 0, 0, -1);
    expect(stage.scrollTop).toBe(10);

    stage.scrollTop = 0;
    keepCaretInView(start, { top: 60, left: 0, bottom: 130, right: 10 }, 0, 0, -1);
    expect(stage.scrollTop).toBe(20);

    stage.scrollTop = 0;
    keepCaretInView(start, { top: 10, left: 0, bottom: 26, right: 10 }, 1000, 1000, 1);
    expect(stage.scrollTop).toBe(16);

    stage.scrollTop = 0;
    keepCaretInView(start, { top: 0, left: 0, bottom: 16, right: 10 }, -20, -20, 1);
    expect(stage.scrollTop).toBe(-10);
    stage.remove();
  });

  it("tells the cursor hook about selection and skipped edits", () => {
    const cursors: number[] = [];
    const changes: string[] = [];
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      {
        onChange: (value) => changes.push(value.text),
        onCursor: (_document, cursor) => cursors.push(cursor),
      },
    );
    const before = cursors.length;
    editor.view.dispatch({ selection: { anchor: 2 } });
    expect(cursors).toEqual([...cursors.slice(0, before), 2]);
    expect(changes).toEqual([]);

    editor.view.dispatch({
      changes: { from: 0, insert: "X" },
      selection: null as never,
      userEvent: "structure.skip",
    });
    expect(editor.getDocument().text).toBe("XWait.");
    expect(cursors.at(-1)).toBe(editor.view.state.selection.main.head);
    expect(cursors.length).toBe(before + 2);
    expect(changes).toEqual(["XWait."]);
    editor.view.destroy();
  });

  it("moves into the following dialogue without rewriting it", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "ANN" },
        { type: "dialogue", text: "Hi." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const dialogue = editor.getDocument().elements[1];
    editor.view.dispatch({ selection: { anchor: editor.getDocument().elements[0].to } });
    const enter = pressKey(editor, "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(editor.getDocument().text).toBe("ANN\nHi.");
    expect(editor.view.state.selection.main.head).toBe(dialogue.to);
    expect(scrollTarget(editor)).toBeTruthy();
    parent.remove();
    editor.view.destroy();
  });

  it("drops one trailing space when Return splits an action", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Hello  " }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(5);
    pressKey(editor, "Enter");
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Hello" },
      { type: "action", text: " " },
    ]);
    parent.remove();
    editor.view.destroy();
  });

  it("does not open another line after accepting a cue that already has dialogue", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "character", text: "B" },
        { type: "dialogue", text: " " },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(editor.getDocument().elements[1].to);
    startCompletion(editor.view);
    await vi.waitFor(() => expect(completionStatus(editor.view.state)).toBe("active"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    pressEnter(editor);
    expect(editor.getDocument().text).toBe("BOB\n\nBOB\n ");
    expect(editor.getDocument().elements.map(({ type }) => type)).toEqual(["character", "character", "dialogue"]);
    parent.remove();
    editor.view.destroy();
  });

  it("moves the completion highlight before accepting it", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "ALICE" },
        { type: "dialogue", text: "Hi." },
        { type: "character", text: "ANN" },
        { type: "dialogue", text: "Yo." },
        { type: "character", text: "A" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(editor.getDocument().elements[4].to);
    startCompletion(editor.view);
    await vi.waitFor(() => expect(currentCompletions(editor.view.state).length).toBeGreaterThan(1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const labels = currentCompletions(editor.view.state).map((option) => option.label);
    const down = pressKey(editor, "ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    pressEnter(editor);
    expect(editor.getDocument().elements[4].text).toBe(labels[1]);
    parent.remove();
    editor.view.destroy();
  });

  it("offers the only matching name", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hi." },
        { type: "action", text: "B" },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    editor.goto(editor.getDocument().elements[2].to);
    useElement(editor, "character");
    expect(editor.getDocument().elements[2]).toMatchObject({ type: "character", text: "B" });
    await vi.waitFor(() => expect(currentCompletions(editor.view.state).map((option) => option.label)).toEqual(["BOB"]));
    editor.setElements(normalizeElements([{ type: "action", text: "Wait." }]));
    editor.goto(editor.getDocument().elements[0].to);
    useElement(editor, "action");
    expect(completionStatus(editor.view.state)).toBeNull();
    parent.remove();
    editor.view.destroy();
  });

  it("does not start a completion when the line has no choices", () => {
    const cursors: number[] = [];
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: (_document, cursor) => cursors.push(cursor) },
    );
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const before = cursors.length;
    useElement(editor, "action");
    expect(editor.getDocument().elements[0]).toMatchObject({ type: "action", text: "Wait." });
    expect(completionStatus(editor.view.state)).toBeNull();
    expect(cursors.length).toBe(before);
    editor.view.destroy();
  });

  it("pads the completion menu inside the stage", () => {
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 300, height: 400, top: 20, left: 10, bottom: 420, right: 310, toJSON() { return {}; },
    });
    document.body.append(stage);
    const editor = createEditor(
      stage,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const root = document.documentElement;
    expect(completionTooltipSpace(editor.view)).toEqual({
      top: 24,
      left: 14,
      bottom: Math.min(root.clientHeight, 420) - 4,
      right: Math.min(root.clientWidth, 310) - 4,
    });
    stage.remove();
    const loose = createEditor(
      document.createElement("div"),
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    expect(completionTooltipSpace(loose.view)).toEqual({
      top: 4,
      left: 4,
      bottom: root.clientHeight - 4,
      right: root.clientWidth - 4,
    });
    editor.view.destroy();
    loose.view.destroy();
  });

  it("pastes structured elements instead of the plain text", () => {
    const parent = document.createElement("div");
    const editor = createEditor(parent, [], { onChange: () => undefined, onCursor: () => undefined });
    const mime = "application/x-scriptwriter-elements+json";
    const pasted = dispatchClipboard(editor, "paste", {
      [mime]: JSON.stringify([
        { type: "character", text: "ANN", blanksBefore: 0 },
        { type: "dialogue", text: "Hi.", blanksBefore: 0 },
        { type: "action", text: "Go.", blanksBefore: 1 },
      ]),
      "text/plain": "ANN\nHi.\n\nGo.",
    });
    expect(pasted.defaultPrevented).toBe(true);
    expect(editor.getDocument().text).toBe("ANN\nHi.\n\nGo.");
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "character", text: "ANN" },
      { type: "dialogue", text: "Hi." },
      { type: "action", text: "Go." },
    ]);
    editor.goto(editor.view.state.doc.length);
    dispatchClipboard(editor, "paste", { "text/plain": "!" });
    expect(editor.getDocument().text).toBe("ANN\nHi.\n\nGo.!");
    editor.view.destroy();
  });

  it("keeps a typed character when the following line is undone", () => {
    const parent = document.createElement("div");
    const editor = createEditor(
      parent,
      normalizeElements([{ type: "action", text: "Wait." }]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const end = editor.view.state.doc.length;
    typeText(editor, end, "!");
    expect(editor.getDocument().text).toBe("Wait.!");
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: "\nNext" },
      annotations: Transaction.userEvent.of("input"),
    });
    expect(editor.getDocument().elements.map((element) => element.text)).toEqual(["Wait.!", "Next"]);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocument().text).toBe("Wait.!");
    editor.view.destroy();
  });

  it("leaves the earlier scene intact when a later selection is deleted", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createEditor(
      parent,
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
        { type: "action", text: "Stay." },
      ]),
      { onChange: () => undefined, onCursor: () => undefined },
    );
    const wait = editor.getDocument().elements[1];
    const stay = editor.getDocument().elements[2];
    editor.view.dispatch({ selection: { anchor: wait.from, head: stay.to } });
    const removed = pressKey(editor, "Backspace");
    expect(removed.defaultPrevented).toBe(true);
    expect(editor.getDocument().elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "ROOM" },
    ]);
    parent.remove();
    editor.view.destroy();
  });
});

function scrollTarget(editor: ScriptEditor): unknown {
  return (editor.view as unknown as { viewState: { scrollTarget: unknown } }).viewState.scrollTarget;
}

function mountPorts(ports: HTMLElement[]): HTMLElement {
  const start = document.createElement("div");
  let parent = ports[0];
  document.body.append(parent);
  for (const next of ports.slice(1)) {
    parent.append(next);
    parent = next;
  }
  parent.append(start);
  return start;
}

function fakePort(
  overflowX: string,
  overflowY: string,
  box: { top: number; left: number; bottom: number; right: number },
): HTMLElement {
  const node = document.createElement("div");
  node.style.overflowX = overflowX;
  node.style.overflowY = overflowY;
  const height = box.bottom - box.top;
  const width = box.right - box.left;
  Object.defineProperty(node, "clientHeight", { configurable: true, get: () => height });
  Object.defineProperty(node, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(node, "clientTop", { configurable: true, get: () => 0 });
  Object.defineProperty(node, "clientLeft", { configurable: true, get: () => 0 });
  node.getBoundingClientRect = () =>
    ({
      top: box.top,
      left: box.left,
      bottom: box.bottom,
      right: box.right,
      width,
      height,
      x: box.left,
      y: box.top,
      toJSON() {
        return {};
      },
    }) as DOMRect;
  let top = 0;
  let left = 0;
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  Object.defineProperty(node, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = value;
    },
  });
  return node;
}

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
  return event;
}

function modifier(): KeyboardEventInit {
  return /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
}
