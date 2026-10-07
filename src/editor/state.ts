import { invertedEffects } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, type Extension, type Transaction } from "@codemirror/state";
import { snapshot, type DocumentSnapshot, type EditorDocument, type LineType } from "../domain/document";

type Metadata = { lineTypes: readonly LineType[]; revision: number };

export const replaceLineTypes = StateEffect.define<readonly LineType[]>();

function metadata(lineTypes: readonly LineType[]): Metadata {
  const revision = 0;
  return { lineTypes, revision };
}

const metadataField = StateField.define<Metadata>({
  create: (state) => metadata(Array.from({ length: state.doc.lines }, () => null)),
  update(value, transaction) {
    const effect = transaction.effects.find((item) => item.is(replaceLineTypes));
    const lineTypes = effect === undefined ? value.lineTypes : effect.value;
    const changed = transaction.docChanged || effect !== undefined;
    if (transaction.newDoc.lines !== lineTypes.length) {
      throw new Error("A screenplay transaction changed lines without matching element metadata.");
    }
    return { lineTypes, revision: changed ? value.revision + 1 : value.revision };
  },
});

const snapshotCache = new WeakMap<EditorState, DocumentSnapshot>();

export function documentOf(state: EditorState): DocumentSnapshot {
  const cached = snapshotCache.get(state);
  if (cached) return cached;
  const metadata = state.field(metadataField);
  const document = snapshot(
    { text: state.doc.toString(), lineTypes: metadata.lineTypes },
    metadata.revision,
  );
  snapshotCache.set(state, document);
  return document;
}

export function metadataExtensions(document: EditorDocument): Extension[] {
  return [
    metadataField.init(() => metadata([...document.lineTypes])),
    invertedEffects.of((transaction) => {
      if (!metadataChanged(transaction)) return [];
      return [replaceLineTypes.of(transaction.startState.field(metadataField).lineTypes)];
    }),
  ];
}

export function lineTypesOf(state: EditorState): readonly LineType[] {
  return state.field(metadataField).lineTypes;
}

export function revisionOf(state: EditorState): number {
  return state.field(metadataField).revision;
}

export function metadataChanged(transaction: Transaction): boolean {
  return transaction.effects.some((effect) => effect.is(replaceLineTypes));
}

export function sameLineTypes(left: readonly LineType[], right: readonly LineType[]): boolean {
  return left.length === right.length && left.every((type, index) => type === right[index]);
}
