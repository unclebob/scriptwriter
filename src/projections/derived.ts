import type { DocumentSnapshot } from "../domain/document";
import { pageStarts, paginate, type Placed } from "./layout";
import { sceneIndex, type OutlineRow, type SceneRow } from "./scenes";

export type DerivedDocument = {
  pages: readonly Placed[][];
  pageStarts: readonly number[];
  outline: readonly OutlineRow[];
  scenes: readonly SceneRow[];
};

let cache = new WeakMap<DocumentSnapshot, DerivedDocument>();
let derivations = 0;

export function derive(document: DocumentSnapshot): DerivedDocument {
  const cached = cache.get(document);
  if (cached) return cached;
  derivations += 1;
  const pages = paginate(document);
  const starts = pageStarts(pages);
  const indexed = sceneIndex(document, starts);
  const value: DerivedDocument = {
    pages,
    pageStarts: starts,
    outline: indexed.outline,
    scenes: indexed.scenes,
  };
  cache.set(document, value);
  return value;
}

export function derivationCount(): number {
  return derivations;
}

export function resetDerivedCache(): void {
  cache = new WeakMap();
  derivations = 0;
}
