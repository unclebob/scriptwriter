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

  it("does not provide scene-prefix, location, or time completion", () => {
    const scene = elementsDocument(normalizeElements([{ type: "scene", text: "INT." }]));
    expect(completions(scene, scene.text.length)).toBeNull();
  });
});
