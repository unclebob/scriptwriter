import { describe, expect, it } from "vitest";
import { elementsDocument } from "./document";
import {
  createPlaceWriter,
  encodePlace,
  mapEditorSelection,
  parsePlace,
  screenplayPlace,
  titlePlace,
} from "./place";

const hello = elementsDocument([
  { type: "action", text: "Stay.", blanksBefore: 0 },
  { type: "action", text: "Hello", blanksBefore: 0 },
]);

describe("screenplay place", () => {
  it("records a caret as an element index and a code point", () => {
    const cursor = hello.elements[1].from + 1;
    expect(encodePlace(screenplayPlace(hello, cursor, cursor))).toBe(
      '{"file":"script.json","focus":"screenplay","selection":{"kind":"caret","at":{"kind":"text","index":1,"offset":1}}}',
    );
  });

  it("counts an emoji as one code point", () => {
    const document = elementsDocument([{ type: "action", text: "a😀b", blanksBefore: 0 }]);
    const cursor = utf16Of("a😀b", 2);
    expect(encodePlace(screenplayPlace(document, cursor, cursor))).toBe(
      '{"file":"script.json","focus":"screenplay","selection":{"kind":"caret","at":{"kind":"text","index":0,"offset":2}}}',
    );
  });

  it("records a range with the writer's direction", () => {
    const anchor = hello.elements[0].from + 1;
    const head = hello.elements[1].from + 2;
    const place = screenplayPlace(hello, anchor, head);
    expect(place.selection).toEqual({
      kind: "range",
      anchor: { kind: "text", index: 0, offset: 1 },
      head: { kind: "text", index: 1, offset: 2 },
    });
  });

  it("records a blank line as the gap before the next element", () => {
    const spaced = elementsDocument([
      { type: "action", text: "Stay.", blanksBefore: 0 },
      { type: "action", text: "Hello", blanksBefore: 1 },
    ]);
    const blank = spaced.elements[1].from - 1;
    expect(screenplayPlace(spaced, blank, blank).selection).toEqual({
      kind: "caret",
      at: { kind: "gap", before: 1 },
    });
  });

  it("records an empty script as the opening gap", () => {
    const empty = elementsDocument([]);
    expect(screenplayPlace(empty, 0, 0).selection).toEqual({ kind: "caret", at: { kind: "gap", before: 0 } });
  });

  it("records a title field without a screenplay point", () => {
    expect(encodePlace(titlePlace("contact", "Ada", 1, 1))).toBe(
      '{"file":"script.json","focus":"title","field":"contact","selection":{"kind":"caret","at":1}}',
    );
  });

  it("keeps the caret on the same element when a line is inserted above it", () => {
    const before = elementsDocument([{ type: "action", text: "Runs", blanksBefore: 0 }]);
    const after = elementsDocument([
      { type: "action", text: "Go.", blanksBefore: 0 },
      { type: "action", text: "Runs", blanksBefore: 0 },
    ]);
    expect(mapEditorSelection(before, after, 0, 0)).toEqual({
      anchor: after.elements[1].from,
      head: after.elements[1].from,
    });
  });
});

describe("place.json", () => {
  it("rejects a screenplay value that also names a title field", () => {
    expect(() =>
      parsePlace(
        '{"file":"script.json","focus":"screenplay","field":"title","selection":{"kind":"caret","at":{"kind":"gap","before":0}}}',
      ),
    ).toThrow(/title field/);
  });

  it("rejects a range whose ends are equal", () => {
    expect(() =>
      parsePlace(
        '{"file":"script.json","focus":"screenplay","selection":{"kind":"range","anchor":{"kind":"text","index":0,"offset":1},"head":{"kind":"text","index":0,"offset":1}}}',
      ),
    ).toThrow(/equal/);
  });

  it("writes the latest place when two submits share one turn", async () => {
    const written: string[] = [];
    const writer = createPlaceWriter(
      async (json) => {
        written.push(json);
      },
      async () => {},
    );
    writer.submit(titlePlace("title", "One", 0, 0));
    writer.submit(titlePlace("title", "Two", 1, 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written).toEqual([
      '{"file":"script.json","focus":"title","field":"title","selection":{"kind":"caret","at":1}}',
    ]);
  });
});

function utf16Of(text: string, codePoints: number): number {
  let seen = 0;
  let index = 0;
  while (index < text.length && seen < codePoints) {
    const point = text.codePointAt(index) ?? 0;
    index += point > 0xffff ? 2 : 1;
    seen += 1;
  }
  return index;
}
