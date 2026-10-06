import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import { derivationCount, derive, resetDerivedCache } from "./derived";

describe("derived document cache", () => {
  it("derives a document revision only once", () => {
    resetDerivedCache();
    const document = elementsDocument(normalizeElements([{ type: "scene", text: "ROOM" }]));
    const first = derive(document);
    expect(derive(document)).toBe(first);
    expect(derivationCount()).toBe(1);
    const next = { ...document, revision: 1 };
    derive(next);
    expect(derivationCount()).toBe(2);
  });
});
