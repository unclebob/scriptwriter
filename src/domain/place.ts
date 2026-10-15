import { isOpeningPlaceholder, lineAt, type DocumentSnapshot, type ScriptElement } from "./document";
import type { Script } from "./script";

export type TitleField = keyof Pick<Script, "title" | "credit" | "author" | "draft" | "contact">;

const TITLE_FIELDS: readonly TitleField[] = ["title", "credit", "author", "draft", "contact"];

export type TextPoint = { kind: "text"; index: number; offset: number };

export type GapPoint = { kind: "gap"; before: number };

export type ScriptPoint = TextPoint | GapPoint;

export type Selection<T> = { kind: "caret"; at: T } | { kind: "range"; anchor: T; head: T };

export type ScriptPlace =
  | { file: "script.json"; focus: "screenplay"; selection: Selection<ScriptPoint> }
  | { file: "script.json"; focus: "title"; field: TitleField; selection: Selection<number> };

export function screenplayPlace(document: DocumentSnapshot, anchor: number, head: number): ScriptPlace {
  const start = pointAt(document, anchor);
  const end = pointAt(document, head);
  return {
    file: "script.json",
    focus: "screenplay",
    selection: selectionOf(start, end, anchor, head),
  };
}

export function titlePlace(field: TitleField, value: string, anchor: number, head: number): ScriptPlace {
  const start = codePointOf(value, anchor);
  const end = codePointOf(value, head);
  return {
    file: "script.json",
    focus: "title",
    field,
    selection: selectionOf(start, end, anchor, head),
  };
}

export function mapEditorSelection(
  before: DocumentSnapshot,
  after: DocumentSnapshot,
  anchor: number,
  head: number,
): { anchor: number; head: number } {
  const place = screenplayPlace(before, anchor, head);
  if (place.focus !== "screenplay") return { anchor, head };
  const matched = matchElements(before.elements, after.elements);
  const mapped = mapSelection(place.selection, before.elements, after.elements, matched);
  return {
    anchor: pointOffset(after, selectionAnchor(mapped)),
    head: pointOffset(after, selectionHead(mapped)),
  };
}

export function encodePlace(place: ScriptPlace): string {
  return JSON.stringify(place);
}

export function parsePlace(json: string): ScriptPlace {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("place.json is not JSON.");
  }
  return readPlace(value);
}

export function createPlaceWriter(
  write: (json: string) => Promise<void>,
  clear: () => Promise<void>,
): { submit(place: ScriptPlace | null): void } {
  let flight: Promise<void> = Promise.resolve();
  let pending: ScriptPlace | null | undefined;
  let queued = false;
  const pump = (): void => {
    if (pending === undefined) return;
    const next = pending;
    pending = undefined;
    flight = flight
      .then(() => (next === null ? clear() : write(encodePlace(next))))
      .then(pump, pump);
  };
  return {
    submit(place) {
      pending = place;
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        pump();
      });
    },
  };
}

function pointAt(document: DocumentSnapshot, cursor: number): ScriptPoint {
  if (isOpeningPlaceholder(document)) return { kind: "gap", before: 0 };
  const line = lineAt(document, Math.max(0, cursor));
  if (line.type === null) return gapBefore(document, line.number);
  const element = document.elements.find((item) => item.line === line.number);
  if (!element) return { kind: "gap", before: document.elements.length };
  return { kind: "text", index: element.index, offset: codePointOf(line.text, cursor - line.from) };
}

function gapBefore(document: DocumentSnapshot, lineNumber: number): GapPoint {
  const next = document.elements.find((element) => element.line > lineNumber);
  if (!next) return { kind: "gap", before: document.elements.length };
  return { kind: "gap", before: next.index };
}

function selectionOf<T>(start: T, end: T, anchor: number, head: number): Selection<T> {
  if (anchor === head || samePoint(start, end)) return { kind: "caret", at: start };
  return { kind: "range", anchor: start, head: end };
}

function samePoint(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function selectionAnchor<T>(selection: Selection<T>): T {
  if (selection.kind === "caret") return selection.at;
  return selection.anchor;
}

function selectionHead<T>(selection: Selection<T>): T {
  if (selection.kind === "caret") return selection.at;
  return selection.head;
}

function mapSelection(
  selection: Selection<ScriptPoint>,
  before: readonly ScriptElement[],
  after: readonly ScriptElement[],
  matched: ReadonlyMap<number, number>,
): Selection<ScriptPoint> {
  const anchor = mapScriptPoint(before, after, matched, selectionAnchor(selection));
  const head = mapScriptPoint(before, after, matched, selectionHead(selection));
  if (samePoint(anchor, head)) return { kind: "caret", at: anchor };
  return { kind: "range", anchor, head };
}

function mapScriptPoint(
  before: readonly ScriptElement[],
  after: readonly ScriptElement[],
  matched: ReadonlyMap<number, number>,
  point: ScriptPoint,
): ScriptPoint {
  if (point.kind === "gap") return mapGap(before, after, matched, point.before);
  const found = matched.get(point.index);
  if (found !== undefined) {
    return { kind: "text", index: found, offset: clampOffset(after[found]?.text ?? "", point.offset) };
  }
  const same = after[point.index];
  const prior = before[point.index];
  if (same && prior && same.type === prior.type) {
    return { kind: "text", index: point.index, offset: mapTextOffset(prior.text, same.text, point.offset) };
  }
  return { kind: "gap", before: clampIndex(point.index, after.length) };
}

function mapGap(
  before: readonly ScriptElement[],
  after: readonly ScriptElement[],
  matched: ReadonlyMap<number, number>,
  index: number,
): GapPoint {
  if (index < before.length) {
    const following = matched.get(index);
    if (following !== undefined) return { kind: "gap", before: following };
  }
  if (index > 0) {
    const preceding = matched.get(index - 1);
    if (preceding !== undefined) return { kind: "gap", before: preceding + 1 };
  }
  return { kind: "gap", before: clampIndex(index, after.length) };
}

function mapTextOffset(before: string, after: string, offset: number): number {
  const prior = [...before];
  const next = [...after];
  const from = sharedPrefix(prior, next);
  const tail = sharedSuffix(prior, next, from);
  const to = prior.length - tail;
  if (offset <= from) return offset;
  if (offset >= to) return clampOffset(after, offset + (next.length - prior.length));
  return from;
}

function sharedPrefix(before: readonly string[], after: readonly string[]): number {
  const limit = Math.min(before.length, after.length);
  let index = 0;
  while (index < limit && before[index] === after[index]) index += 1;
  return index;
}

function sharedSuffix(before: readonly string[], after: readonly string[], prefix: number): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let index = 0;
  while (index < limit && before[before.length - 1 - index] === after[after.length - 1 - index]) index += 1;
  return index;
}

function matchElements(before: readonly ScriptElement[], after: readonly ScriptElement[]): Map<number, number> {
  const rows = before.length;
  const cols = after.length;
  const score: number[][] = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      score[row][col] = sameElement(before[row], after[col])
        ? score[row + 1][col + 1] + 1
        : Math.max(score[row + 1][col], score[row][col + 1]);
    }
  }
  const matched = new Map<number, number>();
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (sameElement(before[row], after[col])) {
      matched.set(row, col);
      row += 1;
      col += 1;
    } else if (score[row + 1][col] >= score[row][col + 1]) row += 1;
    else col += 1;
  }
  return matched;
}

function sameElement(before: ScriptElement | undefined, after: ScriptElement | undefined): boolean {
  return !!before && !!after && before.type === after.type && before.text === after.text;
}

function pointOffset(document: DocumentSnapshot, point: ScriptPoint): number {
  if (point.kind === "gap") return gapOffset(document, point.before);
  const element = document.elements[point.index];
  if (!element) return document.text.length;
  return element.from + utf16Of(element.text, point.offset);
}

function gapOffset(document: DocumentSnapshot, before: number): number {
  if (before <= 0) return 0;
  const element = document.elements[before];
  if (!element) return document.text.length;
  if (element.blanksBefore <= 0) return element.from;
  const line = lineAt(document, Math.max(0, element.from - 1));
  return line.from;
}

function readPlace(value: unknown): ScriptPlace {
  const record = recordOf(value, "place.json");
  if (record.file !== "script.json") throw new Error("place.json file is not script.json.");
  if (record.focus === "screenplay") return readScreenplay(record);
  if (record.focus === "title") return readTitle(record);
  throw new Error("place.json focus is not screenplay or title.");
}

function readScreenplay(record: Record<string, unknown>): ScriptPlace {
  if ("field" in record) throw new Error("place.json screenplay also names a title field.");
  return { file: "script.json", focus: "screenplay", selection: readPointSelection(record.selection) };
}

function readTitle(record: Record<string, unknown>): ScriptPlace {
  if ("at" in record || pointish(record.selection)) {
    throw new Error("place.json title also names a screenplay point.");
  }
  return {
    file: "script.json",
    focus: "title",
    field: titleField(record.field),
    selection: readNumberSelection(record.selection),
  };
}

function pointish(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const at = value.at;
  return isRecord(at) && (at.kind === "text" || at.kind === "gap");
}

function readPointSelection(value: unknown): Selection<ScriptPoint> {
  const record = recordOf(value, "place.json selection");
  if (record.kind === "caret") return { kind: "caret", at: readPoint(record.at) };
  if (record.kind === "range") {
    const anchor = readPoint(record.anchor);
    const head = readPoint(record.head);
    if (samePoint(anchor, head)) throw new Error("place.json range ends are equal.");
    return { kind: "range", anchor, head };
  }
  throw new Error("place.json selection kind is not caret or range.");
}

function readNumberSelection(value: unknown): Selection<number> {
  const record = recordOf(value, "place.json selection");
  if (record.kind === "caret") return { kind: "caret", at: readCount(record.at) };
  if (record.kind === "range") {
    const anchor = readCount(record.anchor);
    const head = readCount(record.head);
    if (anchor === head) throw new Error("place.json range ends are equal.");
    return { kind: "range", anchor, head };
  }
  throw new Error("place.json selection kind is not caret or range.");
}

function readPoint(value: unknown): ScriptPoint {
  const record = recordOf(value, "place.json point");
  if (record.kind === "text") {
    return { kind: "text", index: readCount(record.index), offset: readCount(record.offset) };
  }
  if (record.kind === "gap") return { kind: "gap", before: readCount(record.before) };
  throw new Error("place.json point kind is not text or gap.");
}

function titleField(value: unknown): TitleField {
  if (typeof value === "string" && isTitleField(value)) return value;
  throw new Error("place.json field is not a title field.");
}

function isTitleField(value: string): value is TitleField {
  return TITLE_FIELDS.some((field) => field === value);
}

function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("place.json offset is not a whole number.");
  }
  return value;
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePointOf(text: string, utf16: number): number {
  let end = Math.max(0, Math.min(utf16, text.length));
  if (splitsPair(text, end)) end -= 1;
  let seen = 0;
  let index = 0;
  while (index < end) {
    index += pairWidth(text, index);
    seen += 1;
  }
  return seen;
}

function utf16Of(text: string, codePoints: number): number {
  let seen = 0;
  let index = 0;
  while (index < text.length && seen < codePoints) {
    index += pairWidth(text, index);
    seen += 1;
  }
  return index;
}

function splitsPair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  const prev = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function pairWidth(text: string, index: number): number {
  const point = text.codePointAt(index);
  if (point === undefined) return 1;
  return point > 0xffff ? 2 : 1;
}

function clampOffset(text: string, offset: number): number {
  return Math.max(0, Math.min(offset, [...text].length));
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}
