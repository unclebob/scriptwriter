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
  elementsCovered,
  enter,
  insertBefore,
  insertElements,
  insertPlainText,
  replaceMatches,
  selectedElements,
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
    const everything = doc([
      { type: "action", text: "One" },
      { type: "action", text: "Two" },
    ]);
    const gone = deleteElements(everything, 0, everything.text.length);
    expect(gone?.document.text).toBe("");
    expect(gone?.cursor).toBe(0);
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

  it("stays in the speech that already follows a cue", () => {
    const original = doc([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "Hello." },
    ]);
    const stayed = enter(original, original.elements[0].to);
    expect(stayed.document.text).toBe(original.text);
    expect(stayed.cursor).toBe(original.elements[1].to);

    const aside = doc([
      { type: "character", text: "BOB" },
      { type: "parenthetical", text: "(quietly)" },
      { type: "dialogue", text: "Hello." },
    ]);
    const intoParen = enter(aside, aside.elements[0].to);
    expect(intoParen.document.text).toBe(aside.text);
    const paren = aside.elements[1];
    expect(intoParen.cursor).toBe(paren.from + paren.text.lastIndexOf(")"));
  });

  it("continues from the element above a blank line", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const blank = original.elements[0].to + 1;
    const continued = tab(original, blank);
    expect(next(continued).elements[0]).toMatchObject({ type: "action", text: "ROOM" });
  });

  it("keeps parentheses when replacing parenthetical text", () => {
    const original = doc([{ type: "parenthetical", text: "(quietly)" }]);
    const element = original.elements[0];
    const inner = replaceMatches(
      original,
      [{ from: element.from + 1, to: element.from + 6, inserted: "soft" }],
      0,
    );
    expect(inner?.document.text).toBe("(softly)");
    const whole = replaceMatches(
      original,
      [{ from: element.from, to: element.to, inserted: "softly" }],
      0,
    );
    expect(whole?.document.text).toBe("(softly)");
    expect(whole?.cursor).toBe(7);
  });

  it("can assign an explicit type to the opening element", () => {
    const changed = setElement(elementsDocument([]), 0, "character");
    expect(changed.document).toEqual(editorDocument([{ type: "character", text: "", blanksBefore: 0 }]));
  });

  it("opens the next element when Return is pressed on the blank line between elements", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const opened = enter(original, original.elements[0].to + 1);
    const placed = next(opened);
    expect(placed.elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "" },
      { type: "action", text: "Wait." },
    ]);
    expect(opened.cursor).toBe(placed.elements[1].to);
  });

  it("leaves a non-empty element unchanged when Backspace is at its start", () => {
    const original = doc([{ type: "action", text: "Wait." }]);
    const edit = backspace(original, original.elements[0].from);
    expect(edit?.document).toBe(original);
    expect(edit?.cursor).toBe(original.elements[0].from);
  });

  it("lets Backspace delete a character inside an element", () => {
    const original = doc([{ type: "action", text: "Wait." }]);
    expect(backspace(original, original.elements[0].from + 1)).toBeNull();
  });

  it("leaves a blank line unchanged on Backspace", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const blank = original.elements[0].to + 1;
    const edit = backspace(original, blank);
    expect(edit?.document).toBe(original);
    expect(edit?.cursor).toBe(blank);
  });

  it("lets Delete remove a character inside an element", () => {
    const original = doc([{ type: "action", text: "Wait." }]);
    expect(deleteForward(original, original.elements[0].from + 1)).toBeNull();
  });

  it("leaves a blank line unchanged when assigning a type", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const blank = original.elements[0].to + 1;
    const edit = setElement(original, blank, "dialogue");
    expect(edit.document).toBe(original);
    expect(edit.cursor).toBe(blank);
  });

  it("inserts elements after the element that holds the caret", () => {
    const original = doc([
      { type: "action", text: "Stay." },
      { type: "action", text: "Go." },
    ]);
    const at = original.elements[0].to;
    const inserted = insertElements(original, at, at, [{ type: "action", text: "Next.", blanksBefore: 0 }]);
    expect(next(inserted!).elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Stay." },
      { type: "action", text: "Next." },
      { type: "action", text: "Go." },
    ]);
  });

  it("drops the blank before dialogue and inserts one before a later action", () => {
    const spaced = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const asDialogue = setElement(spaced, spaced.elements[1].from, "dialogue");
    expect(next(asDialogue).text).toBe("ROOM\nWait.");
    expect(next(asDialogue).elements[1]).toMatchObject({ type: "dialogue", text: "Wait.", blanksBefore: 0 });

    const tight = doc([
      { type: "scene", text: "ROOM" },
      { type: "dialogue", text: "Hello." },
    ]);
    expect(tight.text).toBe("ROOM\nHello.");
    const asAction = setElement(tight, tight.elements[1].from, "action");
    expect(next(asAction).text).toBe("ROOM\n\nHello.");
    expect(next(asAction).elements[1]).toMatchObject({ type: "action", text: "Hello.", blanksBefore: 1 });

    const first = setElement(tight, tight.elements[0].from, "action");
    expect(next(first).text).toBe("ROOM\nHello.");
    expect(next(first).elements[0]).toMatchObject({ type: "action", text: "ROOM", blanksBefore: 0 });
  });

  it("splits the element under the caret when that element is not first", () => {
    const original = doc([
      { type: "action", text: "Hi." },
      { type: "action", text: "Bob walks" },
    ]);
    const element = original.elements[1];
    const edit = enter(original, element.from + 4);
    expect(next(edit).elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "action", text: "Hi." },
      { type: "action", text: "Bob" },
      { type: "action", text: "walks" },
    ]);
    expect(edit.document.text.slice(edit.cursor, edit.cursor + 5)).toBe("walks");
  });

  it("leaves the caret on a one-character line when Return is at its start", () => {
    const original = doc([{ type: "action", text: "Z" }]);
    const edit = enter(original, 0);
    expect(edit.document.text).toBe("Z");
    expect(edit.cursor).toBe(0);
  });

  it("places the caret at the start of a one-character tail", () => {
    const original = doc([{ type: "action", text: "Yo" }]);
    const edit = enter(original, 1);
    expect(edit.document.text).toBe("Y\n\no");
    expect(edit.cursor).toBe(edit.document.text.lastIndexOf("o"));
  });

  it("bumps the revision when inserting a line before the caret", () => {
    const original = elementsDocument(normalizeElements([{ type: "action", text: "Stay." }]), 4);
    const inserted = insertBefore(original, 0);
    expect((inserted.document as DocumentSnapshot).revision).toBe(5);
  });

  it("does not treat a leading blank as a separator when the document has no elements", () => {
    const original = snapshot({ text: "", lineTypes: [null] });
    const edit = setElement(original, 0, "action");
    expect(edit.document.lineTypes).toEqual(["action"]);
    expect(edit.cursor).toBe(0);
  });

  it("leaves the trailing blank after a single element unchanged", () => {
    const original = snapshot({ text: "HI\n", lineTypes: ["scene", null] });
    const edit = setElement(original, original.text.length, "action");
    expect(edit.document).toBe(original);
    expect(edit.cursor).toBe(original.text.length);
  });

  it("converts the element when the caret is past the end of the text", () => {
    const original = doc([{ type: "action", text: "Hello" }]);
    const edit = setElement(original, original.text.length + 5, "character");
    expect(edit.document.text).toBe("HELLO");
    expect(edit.cursor).toBe(5);
  });

  it("reports a collapsed caret on a blank line as a structural edit", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const blank = original.elements[0].to + 1;
    expect(structuralEdit(original, blank, blank)).toBe(true);
  });

  it("excludes an element that only touches a selection boundary", () => {
    const neighbors = doc([
      { type: "action", text: "Hello" },
      { type: "action", text: "World" },
    ]);
    expect(elementSelection(neighbors, neighbors.elements[0].to, neighbors.text.length)).toBeNull();

    const trailingEmpty = doc([
      { type: "action", text: "Hello" },
      { type: "action", text: "" },
    ]);
    const empty = trailingEmpty.elements[1];
    expect(elementSelection(trailingEmpty, 0, empty.from)).toBeNull();
  });

  it("returns null when the selection already covers whole elements", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "One" },
      { type: "action", text: "Two" },
    ]);
    const first = original.elements[1];
    const second = original.elements[2];
    expect(elementSelection(original, first.from, second.to)).toBeNull();
    expect(elementSelection(original, first.from, second.from + 1)).toEqual({
      anchor: first.from,
      head: second.to,
    });
  });

  it("copies covered elements and clears the blank before the first one", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "One" },
      { type: "dialogue", text: "Two" },
      { type: "action", text: "Three" },
    ]);
    const from = original.elements[1].from;
    const to = original.elements[3].to;
    expect(selectedElements(original, from, to)).toEqual([
      { type: "action", text: "One", blanksBefore: 0 },
      { type: "dialogue", text: "Two", blanksBefore: 0 },
      { type: "action", text: "Three", blanksBefore: 1 },
    ]);
  });

  it("inserts pasted elements after the caret when it sits on a blank line", () => {
    const original = doc([
      { type: "action", text: "Stay." },
      { type: "action", text: "Go." },
    ]);
    const blank = original.elements[0].to + 1;
    const inserted = insertElements(original, blank, original.elements[1].from, [
      { type: "action", text: "Next.", blanksBefore: 0 },
    ]);
    expect(next(inserted!).elements.map(({ text }) => text)).toEqual(["Stay.", "Next.", "Go."]);
    expect(inserted!.cursor).toBe(next(inserted!).elements[1].to);
  });

  it("places the caret at the end of text inserted into an empty document", () => {
    const blank = snapshot({ text: "", lineTypes: [null] });
    const inserted = insertElements(blank, 0, 0, [{ type: "action", text: "Hi.", blanksBefore: 0 }]);
    expect(inserted?.document.text).toBe("Hi.");
    expect(inserted?.cursor).toBe(3);

    const opening = insertPlainText(elementsDocument([]), 0, 0, "INT. ROOM\nEXT. ROAD")!;
    expect(opening.cursor).toBe(opening.document.text.length);
  });

  it("keeps a blank line between plain-text paragraphs and not inside one", () => {
    const pasted = insertPlainText(elementsDocument([]), 0, 0, "A\n\nB\nC")!;
    expect(pasted.document.text).toBe("A\n\nB\nC");
  });

  it("keeps the caret at the end of each replaced element", () => {
    const original = elementsDocument(
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Wait." },
        { type: "scene", text: "HALL" },
      ]),
      2,
    );
    const room = original.elements[0];
    const replaced = replaceMatches(original, [{ from: room.from, to: room.to, inserted: "kitchen\nporch" }], 0);
    expect(replaced?.document.text).toBe("KITCHEN\n\nPORCH\n\nWait.\n\nHALL");
    expect(replaced?.cursor).toBe("KITCHEN\n\nPORCH".length);
    expect((replaced?.document as DocumentSnapshot).revision).toBe(3);
  });

  it("applies two changes in reading order and keeps an insertion at the caret", () => {
    const original = doc([{ type: "action", text: "abcdef" }]);
    const element = original.elements[0];
    const at = (index: number) => element.from + index;
    const replaced = replaceMatches(
      original,
      [
        { from: at(4), to: at(5), inserted: "X" },
        { from: at(1), to: at(2), inserted: "Y" },
      ],
      9,
    );
    expect(replaced?.document.text).toBe("aYcdXf");
    const inserted = replaceMatches(original, [{ from: at(2), to: at(2), inserted: "Z" }], 9);
    expect(inserted?.document.text).toBe("abZcdef");
    expect(inserted?.cursor).toBe(at(3));
  });

  it("orders changes that share a start by their ends and ignores a backward range", () => {
    const original = doc([{ type: "action", text: "abcdef" }]);
    const at = (index: number) => original.elements[0].from + index;
    const replaced = replaceMatches(
      original,
      [
        { from: at(1), to: at(4), inserted: "Y" },
        { from: at(1), to: at(2), inserted: "X" },
      ],
      9,
    );
    expect(replaced?.document.text).toBe("aXcdef");
    const backward = replaceMatches(original, [{ from: at(3), to: at(1), inserted: "Z" }], 4);
    expect(backward?.document.text).toBe("abcdef");
    expect(backward?.cursor).toBe(original.elements[0].from);
  });

  it("rejects a change that runs past the end of its element", () => {
    const original = doc([{ type: "action", text: "Hello" }]);
    const element = original.elements[0];
    expect(
      replaceMatches(original, [{ from: element.from + 1, to: element.to + 1, inserted: "Z" }], 0),
    ).toBeNull();
  });

  it("skips the second change when it overlaps the first", () => {
    const original = doc([{ type: "action", text: "abcdef" }]);
    const at = (index: number) => original.elements[0].from + index;
    const replaced = replaceMatches(
      original,
      [
        { from: at(0), to: at(3), inserted: "X" },
        { from: at(2), to: at(4), inserted: "Y" },
      ],
      9,
    );
    expect(replaced?.document.text).toBe("Xdef");
  });

  it("does not shift the caret when the replacement already includes its parentheses", () => {
    const original = doc([{ type: "parenthetical", text: "(quietly)" }]);
    const element = original.elements[0];
    const replaced = replaceMatches(
      original,
      [{ from: element.from + 1, to: element.from + 1, inserted: "z" }],
      9,
    );
    expect(replaced?.document.text).toBe("(zquietly)");
    expect(replaced?.cursor).toBe(element.from + 2);
  });

  it("stops the caret before a parenthetical's closing parenthesis", () => {
    const original = doc([{ type: "parenthetical", text: "(quietly)" }]);
    const element = original.elements[0];
    const replaced = replaceMatches(original, [{ from: element.from, to: element.to, inserted: "softly)" }], 0);
    expect(replaced?.document.text).toBe("(softly)");
    expect(replaced?.cursor).toBe(7);
  });

  it("puts the caret on the visible character when wrapping a parenthetical", () => {
    const original = doc([{ type: "parenthetical", text: "softly" }]);
    const edit = afterInput(original, 3);
    expect(edit.document.text).toBe("(softly)");
    expect(edit.cursor).toBe(4);
  });

  it("keeps an action that merely looks parenthetical on its own cursor math", () => {
    const original = doc([{ type: "action", text: "(Hello)" }]);
    const edit = setElement(original, 2, "character");
    expect(edit.document.text).toBe("(HELLO)");
    expect(edit.cursor).toBe(2);
  });

  it("clamps a parenthetical caret to the character before the closing parenthesis", () => {
    const original = doc([{ type: "action", text: "(hello)" }]);
    const edit = setElement(original, original.text.length, "parenthetical");
    expect(edit.document.text).toBe("(hello)");
    expect(edit.cursor).toBe(6);
  });

  it("removes an empty parenthetical and not a written one", () => {
    const empty = doc([{ type: "parenthetical", text: "()" }]);
    const removed = backspace(empty, empty.elements[0].from + 1);
    expect(removed?.document.text).toBe("");
    const written = doc([{ type: "parenthetical", text: "(soft)" }]);
    expect(backspace(written, written.elements[0].from + 2)).toBeNull();
  });

  it("opens a dialogue line instead of staying on a following action", () => {
    const original = elementsDocument(
      normalizeElements([
        { type: "character", text: "BOB", blanksBefore: 0 },
        { type: "action", text: "Moves.", blanksBefore: 0 },
      ]),
    );
    const edit = enter(original, original.elements[0].to);
    expect(next(edit).elements.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "character", text: "BOB" },
      { type: "dialogue", text: "" },
      { type: "action", text: "Moves." },
    ]);
  });

  it("parks the caret on a parenthetical that is only a closing parenthesis", () => {
    const original = elementsDocument(
      normalizeElements([
        { type: "character", text: "BOB", blanksBefore: 0 },
        { type: "parenthetical", text: ")", blanksBefore: 0 },
      ]),
    );
    const edit = enter(original, original.elements[0].to);
    expect(edit.document.text).toBe(original.text);
    expect(edit.cursor).toBe(original.elements[1].from);
  });

  it("uses the type's own blank when the pasted blank does not match", () => {
    const original = doc([
      { type: "action", text: "Stay." },
      { type: "action", text: "Go." },
    ]);
    const at = original.elements[0].to;
    const inserted = insertElements(original, at, at, [
      { type: "action", text: "Next.", blanksBefore: 0 },
      { type: "dialogue", text: "Hi.", blanksBefore: 1 },
    ]);
    expect(inserted?.document.text).toBe("Stay.\n\nNext.\n\nHi.\n\nGo.");
    expect(inserted?.cursor).toBe(next(inserted!).elements[2].to);
  });

  it("leaves the caret on the element after a blank is added or removed", () => {
    const tight = doc([
      { type: "scene", text: "ROOM" },
      { type: "dialogue", text: "Hello." },
    ]);
    const asAction = setElement(tight, tight.elements[1].from, "action");
    expect(asAction.cursor).toBe(next(asAction).elements[1].from);

    const spaced = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const asDialogue = setElement(spaced, spaced.elements[1].from + 2, "dialogue");
    expect(asDialogue.document.text[asDialogue.cursor]).toBe("i");
  });

  it("drops one extra blank and keeps the caret on that element", () => {
    const original = snapshot({
      text: "A\n\n\nB",
      lineTypes: ["scene", null, null, "action"],
    });
    const action = original.elements[1];
    const edit = setElement(original, action.from + 1, "action");
    expect(edit.document.text).toBe("A\n\nB");
    expect(edit.cursor).toBe(edit.document.text.length);
  });

  it("counts a blank line that starts the document", () => {
    const original = snapshot({
      text: "\nHello",
      lineTypes: [null, "dialogue"],
    });
    const edit = setElement(original, original.elements[0].from, "dialogue");
    expect(edit.document.text).toBe("Hello");
    expect(edit.cursor).toBe(0);
  });

  it("preserves the following element when Return inserts a line between two elements", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const edit = enter(original, original.elements[0].to);
    expect(edit.document.text).toBe("ROOM\n\n\n\nWait.");
  });

  it("puts the caret back where the character was after a parenthetical edit", () => {
    const original = doc([{ type: "parenthetical", text: "(softly)" }]);
    const edit = setElement(original, 4, "parenthetical");
    expect(edit.document.text).toBe("(softly)");
    expect(edit.cursor).toBe(4);
  });

  it("puts the caret at the end of the previous element after Backspace removes the next one", () => {
    const original = doc([
      { type: "action", text: "" },
      { type: "action", text: "" },
      { type: "action", text: "Hi" },
    ]);
    const removed = backspace(original, original.elements[1].from);
    expect(removed?.document.text).toBe("\n\nHi");
    expect(removed?.cursor).toBe(0);
  });

  it("ignores an element that begins where the range ends", () => {
    const neighbors = doc([
      { type: "action", text: "Hello" },
      { type: "action", text: "World" },
    ]);
    const world = neighbors.elements[1];
    expect(elementsCovered(neighbors, 0, world.from).map((element) => element.text)).toEqual(["Hello"]);

    const trailingEmpty = doc([
      { type: "action", text: "Hello" },
      { type: "action", text: "" },
    ]);
    const empty = trailingEmpty.elements[1];
    expect(elementsCovered(trailingEmpty, 0, empty.from).map((element) => element.text)).toEqual(["Hello"]);
  });

  it("keeps a single blank when the new type wants the same gap", () => {
    const original = doc([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Wait." },
    ]);
    const edit = setElement(original, original.elements[1].from, "scene");
    expect(edit.document.text).toBe("ROOM\n\nWAIT.");
  });

  it("keeps the caret on the last character of an unwrapped parenthetical", () => {
    const original = doc([{ type: "parenthetical", text: "softly)" }]);
    const edit = setElement(original, original.text.length, "dialogue");
    expect(edit.document.text).toBe("softly)");
    expect(edit.cursor).toBe(edit.document.text.length - 1);
  });

  it("puts the caret on the first character when a bare parenthetical is wrapped", () => {
    const original = doc([{ type: "parenthetical", text: "softly" }]);
    const edit = setElement(original, 0, "parenthetical");
    expect(edit.document.text).toBe("(softly)");
    expect(edit.cursor).toBe(1);
  });
});
