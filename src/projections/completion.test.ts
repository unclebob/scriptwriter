import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import { completions, otherSpeaker } from "./completion";

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
});
