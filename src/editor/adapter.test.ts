// @vitest-environment jsdom

import { redo, undo } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeElements, type DocumentSnapshot } from "../domain/document";
import { derivationCount, resetDerivedCache } from "../projections/derived";
import { createEditor, useElement } from "./adapter";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
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
});
