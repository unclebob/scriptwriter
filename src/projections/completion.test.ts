import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import { characterNames, completions, otherSpeaker } from "./completion";

const talk = elementsDocument(
  normalizeElements([
    { type: "scene", text: "ROOM" },
    { type: "character", text: "ALICE" },
    { type: "dialogue", text: "Hi." },
    { type: "character", text: "BOB" },
    { type: "dialogue", text: "Hello." },
    { type: "character", text: "" },
  ]),
);

describe("completion", () => {
  it("offers the other speaker first", () => {
    const current = talk.elements.at(-1)!;
    expect(otherSpeaker(talk, current.from)).toBe("ALICE");
    expect(completions(talk, current.from)?.options).toEqual(["ALICE", "BOB"]);
    const solo = elementsDocument(
      normalizeElements([
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Hi." },
        { type: "character", text: "BOB" },
        { type: "character", text: "" },
      ]),
    );
    expect(otherSpeaker(solo, solo.elements.at(-1)!.from)).toBeNull();
  });

  it("offers character extensions and explicit transitions", () => {
    const character = elementsDocument(normalizeElements([{ type: "character", text: "BOB (" }]));
    expect(completions(character, character.text.length)?.options).toContain("(V.O.)");
    const transition = elementsDocument(normalizeElements([{ type: "transition", text: "FADE" }]));
    expect(completions(transition, transition.text.length)?.options).toContain("FADE OUT.");
  });

  it("offers earlier scene headings, most recent first", () => {
    const scenes = elementsDocument(
      normalizeElements([
        { type: "scene", text: "KITCHEN" },
        { type: "action", text: "Bob waits." },
        { type: "scene", text: "KITCHEN DOOR" },
        { type: "action", text: "Rain." },
        { type: "scene", text: "K" },
      ]),
    );
    const current = scenes.elements.at(-1)!;
    expect(completions(scenes, current.to)?.options).toEqual(["KITCHEN DOOR", "KITCHEN"]);
  });

  it("offers a scene heading as one whole line", () => {
    const scenes = elementsDocument(
      normalizeElements([
        { type: "scene", text: "INT. KITCHEN - DAY" },
        { type: "scene", text: "INT" },
      ]),
    );
    const current = scenes.elements[1];
    expect(completions(scenes, current.to)?.options).toEqual(["INT. KITCHEN - DAY"]);
    const location = elementsDocument(
      normalizeElements([
        { type: "scene", text: "INT. KITCHEN - DAY" },
        { type: "scene", text: "KIT" },
      ]),
    );
    expect(completions(location, location.elements[1].to)).toBeNull();
  });

  it("keeps each cue and heading once, and drops an empty one", () => {
    const names = elementsDocument(normalizeElements([
      { type: "character", text: "BOB" },
      { type: "character", text: "BOB (V.O.)" },
      { type: "character", text: "()" },
      { type: "character", text: "ANN" },
    ]));
    expect(characterNames(names)).toEqual(["BOB", "ANN"]);
    const headings = elementsDocument(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "scene", text: "room" },
      { type: "scene", text: "" },
      { type: "scene", text: "" },
    ]));
    const current = headings.elements.at(-1)!;
    expect(completions(headings, current.from)?.options).toEqual(["ROOM"]);
  });

  it("forgets speakers at a new scene or act, and not the cue under the cursor", () => {
    const scene = elementsDocument(normalizeElements([
      { type: "character", text: "ALICE" },
      { type: "scene", text: "ROOM" },
      { type: "character", text: "BOB" },
    ]));
    const bob = scene.elements.at(-1)!;
    expect(otherSpeaker(scene, bob.from)).toBeNull();
    const act = elementsDocument(normalizeElements([
      { type: "character", text: "ALICE" },
      { type: "act", text: "ACT TWO" },
      { type: "character", text: "BOB" },
      { type: "character", text: "" },
    ]));
    expect(otherSpeaker(act, act.elements.at(-1)!.from)).toBeNull();
  });

  it("completes the prefix at the cursor and replaces through the closing parenthesis", () => {
    const named = elementsDocument(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "character", text: "BOB" },
    ]));
    const cue = named.elements[1];
    expect(completions(named, cue.from)?.options).toEqual(["BOB"]);
    const extension = elementsDocument(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "character", text: "BOB (V)" },
    ]));
    const element = extension.elements[1];
    const paren = element.text.indexOf("(");
    const list = completions(extension, element.from + paren);
    expect(list?.options).toContain("(V.O.)");
    expect(list?.from).toBe(element.from + paren);
    expect(list?.to).toBe(element.from + element.text.length);
    const open = elementsDocument(normalizeElements([{ type: "character", text: "(V" }]));
    const started = open.elements[0];
    expect(completions(open, started.from)?.from).toBe(started.from);
    expect(completions(open, started.from)?.to).toBe(started.text.length);
  });

  it("does not treat the cue under the cursor as someone who already spoke", () => {
    const bob = talk.elements[3];
    expect(bob.text).toBe("BOB");
    expect(otherSpeaker(talk, bob.from)).toBeNull();
  });

  it("completes a partial cue through the end of the typed name", () => {
    const named = elementsDocument(normalizeElements([
      { type: "character", text: "BOB" },
      { type: "character", text: "BO" },
    ]));
    const current = named.elements[1];
    const list = completions(named, current.to);
    expect(list?.options).toEqual(["BOB"]);
    expect(list?.from).toBe(current.from);
    expect(list?.to).toBe(current.to);
  });

  it("lists a repeated heading once", () => {
    const scenes = elementsDocument(normalizeElements([
      { type: "scene", text: "KITCHEN" },
      { type: "scene", text: "KITCHEN" },
      { type: "scene", text: "DOOR" },
      { type: "scene", text: "" },
    ]));
    expect(completions(scenes, scenes.elements.at(-1)!.from)?.options).toEqual(["DOOR", "KITCHEN"]);
  });
});
