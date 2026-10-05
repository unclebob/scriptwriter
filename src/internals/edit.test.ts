import { describe, expect, it } from "vitest";
import { afterInput, backspace, deleteElements, deleteForward, elementSelection, enter, insertBefore, insertElements, setElement, shiftTab, structuralEdit, tab } from "./edit";
import { parseScript } from "./fountain";

function typeChars(doc: string, cursor: number, text: string) {
  let state = { doc, cursor };
  for (const char of text) {
    const inserted = state.doc.slice(0, state.cursor) + char + state.doc.slice(state.cursor);
    state = afterInput(inserted, state.cursor + char.length);
  }
  return state;
}

describe("editing", () => {
  it("walks a slug into action, a character, and dialogue", () => {
    let state = typeChars(".", 1, "int. kitchen - day");
    expect(state.doc).toBe("INT. KITCHEN - DAY");
    state = enter(state.doc, state.cursor);
    expect(state.doc).toBe("INT. KITCHEN - DAY\n\n!");
    state = tab(state.doc, state.cursor);
    expect(parseScript(state.doc).at(-1)?.type).toBe("character");
    state = typeChars(state.doc, state.cursor, "bob");
    expect(state.doc.endsWith("@BOB")).toBe(true);
    state = enter(state.doc, state.cursor);
    state = typeChars(state.doc, state.cursor, "You up?");
    expect(parseScript(state.doc).map((element) => element.type)).toEqual([
      "scene",
      "character",
      "dialogue",
    ]);
    expect(parseScript(state.doc).map((element) => element.text)).toEqual([
      "INT. KITCHEN - DAY",
      "BOB",
      "You up?",
    ]);
  });

  it("changes the element with tab and leaves the cursor on the same character", () => {
    const doc = "Bob walks home.";
    const cursor = "Bob ".length;
    const next = tab(doc, cursor);
    expect(parseScript(next.doc)[0]).toMatchObject({ type: "character", text: "BOB WALKS HOME." });
    expect(next.doc[next.cursor]).toBe("W");
  });

  it("cycles tab and shift-tab through every element type", () => {
    let state = { doc: "!", cursor: 1 };
    const forward = ["action"];
    for (let i = 0; i < 8; i += 1) {
      state = tab(state.doc, state.cursor);
      forward.push(parseScript(state.doc)[0].type);
    }
    expect(forward).toEqual([
      "action",
      "character",
      "parenthetical",
      "dialogue",
      "transition",
      "shot",
      "act",
      "scene",
      "action",
    ]);

    state = { doc: "!", cursor: 1 };
    const backward = ["action"];
    for (let i = 0; i < 8; i += 1) {
      state = shiftTab(state.doc, state.cursor);
      backward.push(parseScript(state.doc)[0].type);
    }
    expect(backward).toEqual([
      "action",
      "scene",
      "act",
      "shot",
      "transition",
      "dialogue",
      "parenthetical",
      "character",
      "action",
    ]);
  });

  it("keeps dialogue when the line does not follow a character", () => {
    let state = tab("Bob says hello.", 1);
    state = tab(state.doc, state.cursor);
    expect(parseScript(state.doc)[0].type).toBe("parenthetical");
    state = tab(state.doc, state.cursor);
    expect(parseScript(state.doc)[0]).toMatchObject({ type: "dialogue", text: "BOB SAYS HELLO." });
  });

  it("puts one blank line before a scene heading", () => {
    const next = enter("CUT TO:", "CUT TO:".length);
    expect(next.doc).toBe("CUT TO:\n\n.");
  });

  it("turns a parenthetical into dialogue and leaves the cursor", () => {
    const doc = "@BOB\n(Hello there.)";
    const cursor = doc.indexOf("there");
    const next = tab(doc, cursor);
    expect(parseScript(next.doc).map((element) => element.type)).toEqual(["character", "dialogue"]);
    expect(parseScript(next.doc)[1].text).toBe("Hello there.");
    expect(next.doc[next.cursor]).toBe("t");
  });

  it("splits action and keeps the tail", () => {
    const doc = "Bob walks home.";
    const next = enter(doc, "Bob".length);
    expect(next.doc).toBe("Bob\n\nwalks home.");
    expect(next.cursor).toBe("Bob\n\n".length);
  });

  it("turns an action line into a slug once it reads INT.", () => {
    const next = typeChars("!", 1, "ext. porch - night");
    expect(next.doc).toBe("EXT. PORCH - NIGHT");
  });

  it("turns a plain act label into an act and then a scene", () => {
    const act = typeChars("!", 1, "act one");
    expect(act.doc).toBe("ACT ONE");
    expect(parseScript(act.doc)[0].type).toBe("act");
    const scene = enter(act.doc, act.cursor);
    expect(scene.doc).toBe("ACT ONE\n\n.");
    expect(parseScript(scene.doc).map((element) => element.type)).toEqual(["act", "scene"]);
  });

  it("keeps all-caps action from being read as a shot", () => {
    const next = typeChars("!", 1, "BOOM.");
    expect(parseScript(next.doc)[0]).toMatchObject({ type: "action", text: "BOOM." });
  });

  it("restores a deleted parenthesis", () => {
    const doc = "@BOB\n(quietly)";
    const broken = doc.slice(0, -1);
    const next = afterInput(broken, broken.length);
    expect(next.doc).toBe("@BOB\n(quietly)");
  });

  it("removes an empty element on backspace", () => {
    const doc = "INT. KITCHEN - DAY\n\n!";
    const next = backspace(doc, doc.length);
    expect(next?.doc).toBe("INT. KITCHEN - DAY");
    expect(next?.cursor).toBe("INT. KITCHEN - DAY".length);
  });

  it("does not delete the hidden marker", () => {
    expect(backspace("@BOB", 1)).toEqual({ doc: "@BOB", cursor: 1 });
    expect(backspace("@BOB", 2)).toBeNull();
  });

  it("does not join the next line when Delete is at the end of an element", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.\n\nHe sits.";
    const end = doc.indexOf("walks.") + "walks.".length;
    expect(deleteForward(doc, end)).toEqual({ doc, cursor: end });
    expect(deleteForward(doc, doc.indexOf("Bob"))).toBeNull();
    expect(structuralEdit(doc, end, end + 1)).toBe(true);
    expect(structuralEdit(doc, doc.indexOf("Bob"), doc.indexOf("Bob") + 1)).toBe(false);
  });

  it("leaves a blank line unchanged", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.";
    const blank = doc.indexOf("\n\n") + 1;
    expect(backspace(doc, blank)).toEqual({ doc, cursor: blank });
    expect(deleteForward(doc, blank)).toEqual({ doc, cursor: blank });
    expect(setElement(doc, blank, "character")).toEqual({ doc, cursor: blank });
    expect(structuralEdit(doc, blank, blank)).toBe(true);
  });

  it("inserts an empty element of the same type before that line", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.";
    const action = insertBefore(doc, doc.indexOf("Bob"));
    expect(action.doc).toBe("INT. KITCHEN - DAY\n\n!\n\nBob walks.");
    expect(action.cursor).toBe("INT. KITCHEN - DAY\n\n!".length);

    const scene = insertBefore(doc, 0);
    expect(scene.doc).toBe(".\n\nINT. KITCHEN - DAY\n\nBob walks.");
    expect(scene.cursor).toBe(1);

    const speech = "@BOB\nHello.";
    expect(insertBefore(speech, speech.indexOf("Hello")).doc).toBe("@BOB\n\u200B\nHello.");

    const porch = "INT. KITCHEN - DAY\n\nEXT. PORCH - NIGHT";
    const between = insertBefore(porch, porch.indexOf("\n\n") + 1);
    expect(parseScript(between.doc).map((element) => element.text)).toEqual(["INT. KITCHEN - DAY", "", "EXT. PORCH - NIGHT"]);
  });

  it("keeps a selection inside one element and takes every element it crosses", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.\n\nHe sits.";
    const bob = doc.indexOf("Bob");
    expect(elementSelection(doc, bob, bob + 3)).toBeNull();
    const span = elementSelection(doc, bob + 4, doc.indexOf("sits"));
    expect(span).toEqual({ anchor: doc.indexOf("Bob"), head: doc.indexOf("sits.") + "sits.".length });
    expect(doc.slice(span!.anchor, span!.head)).toBe("Bob walks.\n\nHe sits.");
    const upward = elementSelection(doc, doc.indexOf("sits"), bob + 1);
    expect(upward).toEqual({ anchor: doc.indexOf("sits.") + "sits.".length, head: doc.indexOf("Bob") });
  });

  it("deletes every element in a span and leaves one blank line", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.\n\nHe sits.\n\nThen tea.";
    const from = doc.indexOf("Bob");
    const to = doc.indexOf("sits.") + "sits.".length;
    const next = deleteElements(doc, from, to);
    expect(next?.doc).toBe("INT. KITCHEN - DAY\n\nThen tea.");
    expect(next?.cursor).toBe("INT. KITCHEN - DAY\n\n".length);
    expect(deleteElements(doc, from, from + 3)).toBeNull();
  });

  it("deletes a span at the start or the end", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.\n\nHe sits.";
    const head = deleteElements(doc, 0, doc.indexOf("walks.") + "walks.".length);
    expect(head?.doc).toBe("He sits.");
    expect(head?.cursor).toBe(0);
    const tail = deleteElements(doc, doc.indexOf("Bob"), doc.length);
    expect(tail?.doc).toBe("INT. KITCHEN - DAY");
    expect(deleteElements(doc, 0, doc.length)?.doc).toBe(".");
  });

  it("pastes copied elements after the cursor and replaces a span", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.";
    const copied = "He sits.\n\nThen tea.";
    const after = insertElements(doc, doc.indexOf("Bob"), doc.indexOf("Bob"), copied);
    expect(after?.doc).toBe("INT. KITCHEN - DAY\n\nBob walks.\n\nHe sits.\n\nThen tea.");
    const replaced = insertElements(doc, doc.indexOf("INT"), doc.indexOf("walks.") + "walks.".length, "@ALICE\nHello.");
    expect(replaced?.doc).toBe("@ALICE\nHello.");
    expect(insertElements(doc, 0, 0, "Just one line.")).toBeNull();
  });

  it("enters the speech that already follows a character", () => {
    const dialogue = "@ALICE\nHello.";
    const intoDialogue = enter(dialogue, "@ALICE".length);
    expect(intoDialogue).toEqual({ doc: dialogue, cursor: dialogue.indexOf("Hello.") });

    const parenthetical = "@ALICE\n(turning)";
    const intoParen = enter(parenthetical, "@ALICE".length);
    expect(intoParen).toEqual({ doc: parenthetical, cursor: parenthetical.indexOf(")") });
  });

  it("changes the element the cursor is in", () => {
    const shot = setElement("The door.", 3, "shot");
    expect(shot.doc).toBe("~THE DOOR.");
    const action = shiftTab(shot.doc, shot.cursor);
    expect(parseScript(action.doc)[0].type).toBe("transition");
  });

  it("turns a leading blank line into a scene heading on enter", () => {
    expect(enter("\n", 0)).toEqual({ doc: ".", cursor: 1 });
  });

  it("splits an action at its first character and keeps the following action", () => {
    const doc = "INT. KITCHEN - DAY\n\nBob walks.\n\nHe sits.";
    const next = enter(doc, doc.indexOf("Bob"));
    expect(next.doc).toBe("INT. KITCHEN - DAY\n\n\nBob walks.\n\nHe sits.");
    expect(next.cursor).toBe(next.doc.indexOf("Bob"));
  });

  it("drops the space when enter splits an action after a word", () => {
    const doc = "Bob walks.";
    const next = enter(doc, doc.indexOf("walks"));
    expect(next.doc).toBe("Bob\n\nwalks.");
    expect(next.cursor).toBe(next.doc.indexOf("walks"));
  });

  it("turns a leading blank line into an action on tab", () => {
    expect(tab("\n", 0)).toEqual({ doc: "!", cursor: 1 });
  });

  it("leaves a leading blank line alone on shift-tab", () => {
    expect(shiftTab("\n", 0)).toEqual({ doc: "\n", cursor: 0 });
  });

  it("removes the extra blank lines when an action becomes a character", () => {
    const doc = "INT. KITCHEN - DAY\n\n\n\nBob waits.";
    const next = tab(doc, doc.indexOf("Bob"));
    expect(next.doc).toBe("INT. KITCHEN - DAY\n\n@BOB WAITS.");
    expect(next.doc[next.cursor]).toBe("B");
  });

  it("starts an empty script as the requested element", () => {
    expect(setElement("", 0, "action")).toEqual({ doc: "!", cursor: 1 });
  });
});
