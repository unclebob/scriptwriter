import { describe, expect, it } from "vitest";
import {
  editorDocument,
  elementsDocument,
  normalizeElements,
  snapshot,
  type DocumentSnapshot,
  type ScriptElement,
} from "../domain/document";
import {
  afterInput,
  backspace,
  deleteElements,
  deleteForward,
  elementSelection,
  enter,
  insertBefore,
  insertElements,
  insertPlainText,
  replaceMatches,
  setElement,
  shiftTab,
  structuralEdit,
  tab,
  type Edit,
} from "./commands";

function doc(elements: readonly Omit<ScriptElement, "blanksBefore">[]): DocumentSnapshot {
  return elementsDocument(normalizeElements(elements));
}

function next(edit: Edit): DocumentSnapshot {
  return snapshot(edit.document);
}

function typeText(document: DocumentSnapshot, cursor: number, text: string): Edit {
  let state: Edit = { document, cursor };
  for (const character of text) {
    const current = snapshot(state.document);
    const inserted = current.text.slice(0, state.cursor) + character + current.text.slice(state.cursor);
    state = afterInput(snapshot({ text: inserted, lineTypes: current.lineTypes }), state.cursor + character.length);
  }
  return state;
}

describe("typed editing", () => {
  it("uses Return transitions without putting types in text", () => {
    let state = typeText(elementsDocument([]), 0, "kitchen");
    expect(state.document.text).toBe("KITCHEN");
    expect(next(state).elements[0].type).toBe("scene");
    state = enter(next(state), state.cursor);
    expect(state.document.text).toBe("KITCHEN\n\n");
    expect(next(state).elements.map((element) => element.type)).toEqual(["scene", "action"]);
  });

  it("never changes a type based on text prefixes or act labels", () => {
    const action = doc([{ type: "action", text: "" }]);
    for (const text of ["INT. ROOM", "EXT. PORCH", "ACT ONE", "#TEASER", ".LATER"]) {
      const typed = typeText(action, 0, text);
      expect(next(typed).elements[0]).toMatchObject({ type: "action", text });
    }
  });

  it("cycles explicit types and preserves the cursor's visible character", () => {
    const original = doc([{ type: "action", text: "Bob walks." }]);
    const forward = tab(original, 4);
    expect(next(forward).elements[0]).toMatchObject({ type: "character", text: "BOB WALKS." });
    expect(forward.document.text[forward.cursor]).toBe("W");
    const backward = shiftTab(next(forward), forward.cursor);
    expect(next(backward).elements[0].type).toBe("action");
    expect(backward.document.text[backward.cursor]).toBe("W");
  });

  it("wraps and unwraps parentheticals only during explicit conversion", () => {
    const dialogue = doc([{ type: "dialogue", text: "quietly" }]);
    const parenthetical = shiftTab(dialogue, 3);
    expect(parenthetical.document.text).toBe("(quietly)");
    const restored = tab(next(parenthetical), parenthetical.cursor);
    expect(restored.document.text).toBe("quietly");
  });

  it("splits action and keeps the tail", () => {
    const original = doc([{ type: "action", text: "Bob walks home." }]);
    const edit = enter(original, 3);
    expect(edit.document.text).toBe("Bob\n\nwalks home.");
    expect(next(edit).elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Bob" },
      { type: "action", text: "walks home." },
    ]);
    expect(edit.document.text.slice(edit.cursor, edit.cursor + 5)).toBe("walks");
  });

  it("leaves the caret where it is when Return is at the start of an action", () => {
    const original = doc([{ type: "action", text: "Bob walks home." }]);
    const edit = enter(original, 0);
    expect(edit.document.text).toBe("Bob walks home.");
    expect(edit.cursor).toBe(0);
  });

  it("removes empty elements and prevents line joins", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "" },
    ]);
    const removed = backspace(original, original.text.length);
    expect(removed?.document.text).toBe("ROOM");
    expect(deleteForward(original, original.elements[0].to)).toEqual({ document: original, cursor: 4 });
    expect(structuralEdit(original, original.elements[0].to, original.elements[1].from)).toBe(true);
  });

  it("snaps and deletes multi-element selections", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "One" },
      { type: "action", text: "Two" },
    ]);
    expect(elementSelection(original, original.elements[1].from + 1, original.elements[2].from + 1)).toEqual({
      anchor: original.elements[1].from,
      head: original.elements[2].to,
    });
    const removed = deleteElements(original, original.elements[1].from, original.elements[2].to);
    expect(removed?.document.text).toBe("ROOM");
    const withEmpty = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "" },
      { type: "action", text: "Next" },
    ]);
    const cleared = deleteElements(withEmpty, withEmpty.elements[1].from, withEmpty.elements[2].to);
    expect(cleared?.document.text).toBe("ROOM");
  });

  it("inserts explicit types before a line and through structured paste", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const inserted = insertBefore(original, original.elements[1].from);
    expect(next(inserted).elements.map((element) => element.type)).toEqual(["scene", "action", "action"]);
    const opening = insertBefore(elementsDocument([]), 0);
    expect(next(opening).elements.map((element) => element.type)).toEqual(["scene", "scene"]);
    expect(next(opening).elements[0].text).toBe("");
    const pasted = insertElements(original, original.elements[0].from, original.elements[1].to, [
      { type: "character", text: "BOB", blanksBefore: 0 },
      { type: "dialogue", text: "Hello.", blanksBefore: 0 },
    ]);
    expect(next(pasted!).elements.map((element) => element.type)).toEqual(["character", "dialogue"]);
  });

  it("treats multiline plain text as action without inference", () => {
    const pasted = insertPlainText(elementsDocument([]), 0, 0, "INT. ROOM\nEXT. ROAD\n\nACT ONE")!;
    expect(next(pasted).elements.map((element) => element.type)).toEqual(["action", "action", "action"]);
    expect(next(pasted).elements.map((element) => element.text)).toEqual(["INT. ROOM", "EXT. ROAD", "ACT ONE"]);
    expect(pasted.document.text).toBe("INT. ROOM\nEXT. ROAD\n\nACT ONE");
  });

  it("replaces text inside each element and formats every line", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
      { type: "scene", text: "HALL" },
    ]);
    const [room, , hall] = original.elements;
    const replaced = replaceMatches(original, [
      { from: room.from, to: room.to, inserted: "kitchen\nporch" },
      { from: hall.from, to: hall.to, inserted: "yard" },
    ], 0);
    expect(next(replaced!).elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "KITCHEN" },
      { type: "scene", text: "PORCH" },
      { type: "action", text: "Wait." },
      { type: "scene", text: "YARD" },
    ]);
    expect(replaceMatches(original, [{ from: 0, to: original.text.length, inserted: "X" }], 0)).toBeNull();
  });

  it("can assign an explicit type to the opening element", () => {
    const changed = setElement(elementsDocument([]), 0, "character");
    expect(changed.document).toEqual(editorDocument([{ type: "character", text: "", blanksBefore: 0 }]));
  });
});
