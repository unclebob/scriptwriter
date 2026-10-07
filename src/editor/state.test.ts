import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import {
  documentOf,
  lineTypesOf,
  metadataChanged,
  metadataExtensions,
  replaceLineTypes,
  revisionOf,
  sameLineTypes,
} from "./state";

function screenplay() {
  return elementsDocument(normalizeElements([{ type: "action", text: "Hello" }]));
}

function editor() {
  const document = screenplay();
  return {
    document,
    state: EditorState.create({
      doc: document.text,
      extensions: [history(), metadataExtensions(document)],
    }),
  };
}

describe("editor metadata", () => {
  it("starts a document at revision zero", () => {
    const { state } = editor();
    expect(revisionOf(state)).toBe(0);
    expect(documentOf(state).revision).toBe(0);
    expect(lineTypesOf(state)).toEqual(["action"]);
  });

  it("bumps the revision when the text changes and rejects a new line without metadata", () => {
    const { state } = editor();
    const typed = state.update({ changes: { from: 0, to: 0, insert: "X" } });
    expect(revisionOf(typed.state)).toBe(1);
    expect(lineTypesOf(typed.state)).toEqual(["action"]);
    expect(documentOf(typed.state).text.startsWith("X")).toBe(true);
    expect(metadataChanged(typed)).toBe(false);
    expect(() => state.update({ changes: { from: 0, to: 0, insert: "\n" } }).state).toThrow(/element metadata/);
  });

  it("replaces line types without a text change and restores them on undo", () => {
    const { document, state } = editor();
    const changed = state.update({ effects: replaceLineTypes.of(["dialogue"]) });
    expect(metadataChanged(changed)).toBe(true);
    expect(lineTypesOf(changed.state)).toEqual(["dialogue"]);
    expect(revisionOf(changed.state)).toBe(1);
    let current = changed.state;
    const undone = undo({
      state: current,
      dispatch(transaction) {
        current = transaction.state;
      },
    });
    expect(undone).toBe(true);
    expect(lineTypesOf(current)).toEqual(document.lineTypes);
  });

  it("compares line-type lists element by element", () => {
    expect(sameLineTypes(["action"], ["action"])).toBe(true);
    expect(sameLineTypes(["action"], ["dialogue"])).toBe(false);
    expect(sameLineTypes(["action"], ["action", "scene"])).toBe(false);
  });
});
