import {
  editorDocument,
  elementAt,
  isOpeningPlaceholder,
  lineAt,
  normalizeElements,
  snapshot,
  sourceLines,
  storableElements,
  type DocumentSnapshot,
  type EditorDocument,
  type LineType,
  type PositionedElement,
  type ScriptElement,
} from "../domain/document";
import {
  blanksBefore,
  convertText,
  formatText,
  returnNext,
  shiftTabType,
  tabType,
  type ElementType,
} from "../domain/elements";

export type Edit = { document: EditorDocument; cursor: number };

type EditableLine = { text: string; type: LineType };

const OPENS_NEXT = new Set<ElementType>(["scene", "character", "parenthetical", "transition", "act"]);

export function enter(document: DocumentSnapshot, cursor: number): Edit {
  const line = lineAt(document, cursor);
  if (line.type === null) return enterBlank(document, cursor, line.from);
  const element = elementAt(document, cursor);
  if (!element) return unchanged(document, cursor);
  const next = returnNext(element.type);
  if (OPENS_NEXT.has(element.type)) return insertAfter(document, element, next, "");
  return breakLine(document, element, cursor, next);
}

function enterBlank(document: DocumentSnapshot, cursor: number, before: number): Edit {
  const previous = previousElement(document, before);
  if (!previous) return setElement(document, cursor, "scene");
  return enter(document, previous.to);
}

function breakLine(
  document: DocumentSnapshot,
  element: PositionedElement,
  cursor: number,
  next: ElementType,
): Edit {
  const at = Math.max(0, Math.min(element.text.length, cursor - element.from));
  const parts = trimBreak(element.text.slice(0, at), element.text.slice(at));
  const lines = editableLines(document);
  const index = element.line;
  if (parts.left === "") {
    lines[index] = { text: formatText(next, parts.right), type: next };
    const moved = normalizeBlanks(lines, index, next);
    return result(lines, lineCursor(lines, moved, parts.right.length === 0));
  }
  lines[index].text = formatText(element.type, parts.left);
  return placeLine(lines, index, next, parts.right);
}

function trimBreak(left: string, right: string): { left: string; right: string } {
  if (right.startsWith(" ")) return { left, right: right.slice(1) };
  if (left.endsWith(" ")) return { left: left.slice(0, -1), right };
  return { left, right };
}

export function tab(document: DocumentSnapshot, cursor: number): Edit {
  return cycleType(document, cursor, tabType);
}

export function shiftTab(document: DocumentSnapshot, cursor: number): Edit {
  return cycleType(document, cursor, shiftTabType);
}

function cycleType(
  document: DocumentSnapshot,
  cursor: number,
  nextType: (type: ElementType) => ElementType,
): Edit {
  const line = lineAt(document, cursor);
  if (line.type === null) {
    const previous = previousElement(document, line.from);
    return previous ? cycleType(document, previous.to, nextType) : setElement(document, cursor, "action");
  }
  const element = elementAt(document, cursor);
  if (!element) return unchanged(document, cursor);
  return convertLine(document, element, nextType(element.type), cursor);
}

/** An empty element of the same type, placed before the element at the cursor. */
export function insertBefore(document: DocumentSnapshot, cursor: number): Edit {
  const element = elementBeside(document, cursor);
  if (!element) return setElement(document, cursor, "action");
  const elements = document.elements.map(({ type, text, blanksBefore }) => ({ type, text, blanksBefore }));
  elements.splice(element.index, 0, blankElement(element.type));
  const next = snapshot(editorDocument(normalizeElements(elements)), document.revision + 1);
  return { document: next, cursor: typingAt(next.elements[element.index]) };
}

export function setElement(document: DocumentSnapshot, cursor: number, type: ElementType): Edit {
  const element = elementAt(document, cursor);
  if (element) return convertLine(document, element, type, cursor);
  return setEmptyLine(document, cursor, type);
}

function setEmptyLine(document: DocumentSnapshot, cursor: number, type: ElementType): Edit {
  const line = lineAt(document, cursor);
  if (separatorLine(line.type, document.elements.length)) return unchanged(document, cursor);
  const lines = editableLines(document);
  lines[line.number] = { text: formatText(type, line.text), type };
  const moved = normalizeBlanks(lines, line.number, type);
  return result(lines, typingCursor(lines, moved));
}

function separatorLine(type: LineType, elements: number): boolean {
  return type === null && elements > 0;
}

/** Removes an empty element. Returns null when Backspace should delete a character. */
export function backspace(document: DocumentSnapshot, cursor: number): Edit | null {
  const element = elementAt(document, cursor);
  if (!element) return backspaceBlank(document, cursor);
  return backspaceElement(document, element, cursor);
}

function backspaceBlank(document: DocumentSnapshot, cursor: number): Edit | null {
  if (lineAt(document, cursor).type === null) return unchanged(document, cursor);
  return null;
}

function backspaceElement(document: DocumentSnapshot, element: PositionedElement, cursor: number): Edit | null {
  if (emptyElement(element)) return removeElement(document, element);
  if (cursor <= element.from) return unchanged(document, cursor);
  return null;
}

/** Stops Delete at the end of an element. Returns null when Delete should delete a character. */
export function deleteForward(document: DocumentSnapshot, cursor: number): Edit | null {
  const element = elementAt(document, cursor);
  if (!element || cursor >= element.to) return unchanged(document, cursor);
  return null;
}

/** True when an edit would type on a separator line or join logical lines. */
export function structuralEdit(document: DocumentSnapshot, from: number, to: number): boolean {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (lineAt(document, start).type === null) return true;
  return document.text.slice(start, end).includes("\n");
}

/** Elements whose visible text the range touches. */
export function elementsCovered(
  document: DocumentSnapshot,
  from: number,
  to: number,
): PositionedElement[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return [];
  return document.elements.filter((element) => {
    if (element.from === element.to) return element.from >= start && element.from < end;
    return element.from < end && element.to > start;
  });
}

export function elementSelection(
  document: DocumentSnapshot,
  anchor: number,
  head: number,
): { anchor: number; head: number } | null {
  const covered = elementsCovered(document, anchor, head);
  if (covered.length < 2) return null;
  return widenedSelection(covered, anchor, head);
}

function widenedSelection(
  covered: readonly PositionedElement[],
  anchor: number,
  head: number,
): { anchor: number; head: number } | null {
  const from = covered[0].from;
  const to = covered[covered.length - 1].to;
  const next = head >= anchor ? { anchor: from, head: to } : { anchor: to, head: from };
  return sameSelection(next, anchor, head) ? null : next;
}

function sameSelection(next: { anchor: number; head: number }, anchor: number, head: number): boolean {
  return next.anchor === anchor && next.head === head;
}

/** Removes every element the range touches, when that is more than one. */
export function deleteElements(document: DocumentSnapshot, from: number, to: number): Edit | null {
  const covered = elementsCovered(document, from, to);
  if (covered.length < 2) return null;
  return replaceElements(document, covered[0].index, covered.length, []);
}

export function insertElements(
  document: DocumentSnapshot,
  from: number,
  to: number,
  incoming: readonly ScriptElement[],
): Edit | null {
  if (incoming.length === 0) return unchanged(document, from);
  const covered = elementsCovered(document, from, to);
  if (covered.length >= 2) return replaceElements(document, covered[0].index, covered.length, incoming);
  return insertAround(document, from, to, incoming);
}

function insertAround(
  document: DocumentSnapshot,
  from: number,
  to: number,
  incoming: readonly ScriptElement[],
): Edit {
  if (isOpeningPlaceholder(document)) return replaceElements(document, 0, 1, incoming);
  const host = elementAt(document, from) ?? previousElement(document, Math.max(from, to));
  return replaceElements(document, insertionIndex(host), 0, incoming);
}

function insertionIndex(host: PositionedElement | null): number {
  return host ? host.index + 1 : 0;
}

export function insertPlainText(
  document: DocumentSnapshot,
  from: number,
  to: number,
  pasted: string,
): Edit | null {
  const normalized = pasted.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.includes("\n")) return null;
  const elements: ScriptElement[] = [];
  let blank = false;
  for (const text of normalized.split("\n")) {
    if (text === "") {
      blank = true;
      continue;
    }
    elements.push({ type: "action", text, blanksBefore: elements.length === 0 ? 0 : blank ? 1 : 0 });
    blank = false;
  }
  return insertElements(document, from, to, elements);
}

type TextChange = { from: number; to: number; inserted: string };

export function replaceMatches(
  document: DocumentSnapshot,
  changes: readonly TextChange[],
  fallbackCursor: number,
): Edit | null {
  const grouped = groupChanges(document, changes);
  if (grouped.size === 0) return null;
  const built: ScriptElement[] = [];
  let cursorAt: { index: number; offset: number } | null = null;
  for (const element of document.elements) {
    cursorAt = applyGroup(element, grouped.get(element.index), built) ?? cursorAt;
  }
  return replacedDocument(document, built, cursorAt, fallbackCursor);
}

function groupChanges(document: DocumentSnapshot, changes: readonly TextChange[]): Map<number, TextChange[]> {
  const grouped = new Map<number, TextChange[]>();
  for (const change of changes.map(normalizeChange).sort(byPosition)) {
    const element = elementHolding(document, change);
    if (!element) continue;
    const list = grouped.get(element.index) ?? [];
    list.push(change);
    grouped.set(element.index, list);
  }
  return grouped;
}

function normalizeChange(change: TextChange): TextChange {
  return {
    from: change.from,
    to: change.to,
    inserted: change.inserted.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
  };
}

function byPosition(left: TextChange, right: TextChange): number {
  return left.from - right.from || left.to - right.to;
}

function elementHolding(document: DocumentSnapshot, change: TextChange): PositionedElement | null {
  const element = elementAt(document, change.from);
  if (!insideElement(element, document, change)) return null;
  return element;
}

function insideElement(
  element: PositionedElement | null,
  document: DocumentSnapshot,
  change: TextChange,
): element is PositionedElement {
  if (!element || change.to > element.to) return false;
  return !document.text.slice(change.from, change.to).includes("\n");
}

function applyGroup(
  element: PositionedElement,
  group: TextChange[] | undefined,
  built: ScriptElement[],
): { index: number; offset: number } | null {
  if (!group) {
    built.push({ type: element.type, text: element.text, blanksBefore: element.blanksBefore });
    return null;
  }
  return rewriteElement(element, group, built);
}

function rewriteElement(
  element: PositionedElement,
  group: readonly TextChange[],
  built: ScriptElement[],
): { index: number; offset: number } {
  const rewritten = spliceText(element.text, element.from, group);
  const pieces = rewritten.text.split("\n");
  const start = built.length;
  pieces.forEach((raw, index) => pushPiece(built, element, raw, index));
  const located = locateOffset(rewritten.text, rewritten.cursor);
  return {
    index: start + located.part,
    offset: formattedOffset(element.type, pieceAt(pieces, located.part), located.offset),
  };
}

function pieceAt(pieces: readonly string[], part: number): string {
  return pieces[part] ?? "";
}

function pushPiece(built: ScriptElement[], element: PositionedElement, raw: string, index: number) {
  built.push({
    type: element.type,
    text: formatText(element.type, raw),
    blanksBefore: pieceBlank(element, index),
  });
}

function pieceBlank(element: PositionedElement, index: number): 0 | 1 {
  return index === 0 ? element.blanksBefore : blanksBefore(element.type);
}

function replacedDocument(
  document: DocumentSnapshot,
  built: readonly ScriptElement[],
  placed: { index: number; offset: number } | null,
  fallbackCursor: number,
): Edit {
  const next = snapshot(editorDocument(normalizeElements(built)), document.revision + 1);
  return { document: next, cursor: replacedCursor(next, placed, fallbackCursor) };
}

function replacedCursor(
  next: DocumentSnapshot,
  placed: { index: number; offset: number } | null,
  fallbackCursor: number,
): number {
  const target = placed ? next.elements[placed.index] : undefined;
  if (!target || !placed) return fallbackCursor;
  return Math.min(target.to, Math.max(target.from, target.from + placed.offset));
}

function spliceText(text: string, base: number, changes: readonly TextChange[]): { text: string; cursor: number } {
  let built = "";
  let at = 0;
  let cursor = 0;
  for (const change of changes) {
    const start = change.from - base;
    const end = change.to - base;
    if (start < at || end > text.length || start > end) continue;
    built += text.slice(at, start) + change.inserted;
    cursor = built.length;
    at = end;
  }
  return { text: built + text.slice(at), cursor };
}

function locateOffset(text: string, cursor: number): { part: number; offset: number } {
  let part = 0;
  let offset = cursor;
  const lines = text.split("\n");
  for (const line of lines) {
    if (offset <= line.length) return { part, offset };
    offset -= line.length + 1;
    part += 1;
  }
  const last = lines.length - 1;
  return { part: last, offset: lines[last]?.length ?? 0 };
}

function formattedOffset(type: ElementType, raw: string, offset: number): number {
  if (type !== "parenthetical") return offset;
  return parentheticalOffset(raw, offset);
}

function parentheticalOffset(raw: string, offset: number): number {
  const formatted = formatText("parenthetical", raw);
  const shift = openingShift(formatted, raw);
  return Math.min(Math.max(offset + shift, shift), parenLimit(formatted, shift));
}

function openingShift(formatted: string, raw: string): number {
  return formatted.startsWith("(") && !raw.startsWith("(") ? 1 : 0;
}

function parenLimit(formatted: string, shift: number): number {
  if (!formatted.endsWith(")")) return formatted.length;
  return Math.max(shift, formatted.length - 1);
}

export function selectedElements(
  document: DocumentSnapshot,
  from: number,
  to: number,
): ScriptElement[] {
  return elementsCovered(document, from, to).map(({ type, text, blanksBefore }, index) => ({
    type,
    text,
    blanksBefore: index === 0 ? 0 : blanksBefore,
  }));
}

export function afterInput(document: DocumentSnapshot, cursor: number): Edit {
  const element = elementAt(document, cursor);
  if (!element) return unchanged(document, cursor);
  const formatted = formatText(element.type, element.text);
  if (formatted === element.text) return unchanged(document, cursor);
  const offset = visibleOffset(element, cursor);
  const lines = editableLines(document);
  lines[element.line].text = formatted;
  const next = result(lines, 0);
  const fresh = snapshot(next.document).elements[element.index];
  return { document: next.document, cursor: placeOffset(fresh, offset) };
}

function convertLine(
  document: DocumentSnapshot,
  element: PositionedElement,
  type: ElementType,
  cursor: number,
): Edit {
  const offset = visibleOffset(element, cursor);
  const lines = editableLines(document);
  lines[element.line] = { type, text: convertText(element.type, type, element.text) };
  const moved = normalizeBlanks(lines, element.line, type);
  const next = result(lines, 0);
  const fresh = snapshot(next.document).elements.find((item) => item.line === moved);
  return { document: next.document, cursor: fresh ? placeOffset(fresh, offset) : 0 };
}

function insertAfter(
  document: DocumentSnapshot,
  element: PositionedElement,
  type: ElementType,
  text: string,
): Edit {
  const touching = continuedLine(document.elements[element.index + 1], type, text);
  if (touching) return unchanged(document, typingAt(touching));
  return placeLine(editableLines(document), element.line, type, text);
}

function continuedLine(
  touching: PositionedElement | undefined,
  type: ElementType,
  text: string,
): PositionedElement | null {
  if (!openRun(touching, text)) return null;
  return acceptsNext(touching, type) ? touching : null;
}

function openRun(touching: PositionedElement | undefined, text: string): touching is PositionedElement {
  return !!touching && touching.blanksBefore === 0 && text === "";
}

function acceptsNext(touching: PositionedElement, type: ElementType): boolean {
  if (touching.type === type) return true;
  return type === "dialogue" && touching.type === "parenthetical";
}

function removeElement(document: DocumentSnapshot, element: PositionedElement): Edit {
  return replaceElements(document, element.index, 1, []);
}

function replaceElements(
  document: DocumentSnapshot,
  index: number,
  count: number,
  incoming: readonly ScriptElement[],
): Edit {
  const elements = storableElements(document);
  elements.splice(index, count, ...storedIncoming(incoming, index));
  return finishReplace(document, elements, index, incoming.length);
}

function storedIncoming(incoming: readonly ScriptElement[], index: number): ScriptElement[] {
  return normalizeElements(incoming).map((element, offset) => ({
    ...element,
    blanksBefore: keptBlank(element, offset, index),
  }));
}

function keptBlank(element: ScriptElement, offset: number, index: number): 0 | 1 {
  if (offset === 0 && index > 0) return blanksBefore(element.type);
  return element.blanksBefore;
}

function finishReplace(document: DocumentSnapshot, elements: ScriptElement[], index: number, incoming: number): Edit {
  const nextDocument = editorDocument(normalizeElements(elements));
  const next = snapshot(nextDocument, document.revision + 1);
  if (incoming > 0) return { document: nextDocument, cursor: insertedEnd(next, index, incoming) };
  return { document: nextDocument, cursor: cursorAfterRemoval(next, index) };
}

function insertedEnd(next: DocumentSnapshot, index: number, incoming: number): number {
  const last = next.elements[index + incoming - 1];
  return last ? last.to : 0;
}

function cursorAfterRemoval(next: DocumentSnapshot, index: number): number {
  return elementEnd(next.elements[index - 1]) ?? elementStart(next.elements[index]);
}

function elementEnd(element: PositionedElement | undefined): number | undefined {
  return element?.to;
}

function elementStart(element: PositionedElement | undefined): number {
  return element?.from ?? 0;
}

function placeLine(lines: EditableLine[], after: number, type: ElementType, text: string): Edit {
  const blanks = after < 0 ? 0 : blanksBefore(type);
  const addition: EditableLine[] = [];
  for (let count = 0; count < blanks; count += 1) addition.push({ text: "", type: null });
  addition.push({ text: formatText(type, text), type });
  const index = after + 1 + blanks;
  lines.splice(after + 1, 0, ...addition);
  return result(lines, lineCursor(lines, index, text.length === 0));
}

function normalizeBlanks(lines: EditableLine[], index: number, type: ElementType): number {
  const want = index === 0 ? 0 : blanksBefore(type);
  return adjustSeparators(lines, index, separatorCount(lines, index), want);
}

function separatorCount(lines: readonly EditableLine[], index: number): number {
  let count = 0;
  for (let at = index - 1; at >= 0 && lines[at].type === null; at -= 1) count += 1;
  return count;
}

function adjustSeparators(lines: EditableLine[], index: number, count: number, want: number): number {
  if (count > want) return dropSeparators(lines, index, count, want);
  if (count < want) return addSeparators(lines, index, count, want);
  return index;
}

function dropSeparators(lines: EditableLine[], index: number, count: number, want: number): number {
  lines.splice(index - count, count - want);
  return index - (count - want);
}

function addSeparators(lines: EditableLine[], index: number, count: number, want: number): number {
  const blanks = Array.from({ length: want - count }, () => ({ text: "", type: null as LineType }));
  lines.splice(index, 0, ...blanks);
  return index + blanks.length;
}

function result(lines: EditableLine[], cursor: number): Edit {
  if (!lines.some((line) => line.type !== null)) return { document: editorDocument([]), cursor: 0 };
  trimSeparators(lines);
  return {
    document: { text: lines.map((line) => line.text).join("\n"), lineTypes: lines.map((line) => line.type) },
    cursor,
  };
}

function trimSeparators(lines: EditableLine[]) {
  while (lines.length > 1 && lines[lines.length - 1].type === null) lines.pop();
}

function editableLines(document: EditorDocument): EditableLine[] {
  return sourceLines(document).map(({ text, type }) => ({ text, type }));
}

function previousElement(document: DocumentSnapshot, before: number): PositionedElement | null {
  let previous: PositionedElement | null = null;
  for (const element of document.elements) {
    if (element.from >= before) break;
    previous = element;
  }
  return previous;
}

function elementBeside(document: DocumentSnapshot, cursor: number): PositionedElement | null {
  return elementAt(document, cursor) ?? document.elements.find((element) => element.from >= cursor) ?? null;
}

function blankElement(type: ElementType): ScriptElement {
  return { type, text: formatText(type, ""), blanksBefore: blanksBefore(type) };
}

function emptyElement(element: PositionedElement): boolean {
  return element.text === "" || (element.type === "parenthetical" && element.text === "()");
}

function lineCursor(lines: EditableLine[], index: number, empty: boolean): number {
  const document = snapshot({
    text: lines.map((line) => line.text).join("\n"),
    lineTypes: lines.map((line) => line.type),
  });
  const element = document.elements.find((item) => item.line === index);
  if (!element) return 0;
  return empty ? typingAt(element) : textStart(element);
}

function textStart(element: PositionedElement): number {
  if (element.type === "parenthetical" && element.text.startsWith("(")) {
    return Math.min(element.from + 1, element.to);
  }
  return element.from;
}

function typingCursor(lines: EditableLine[], index: number): number {
  const document = snapshot({ text: lines.map((line) => line.text).join("\n"), lineTypes: lines.map((line) => line.type) });
  const element = document.elements.find((item) => item.line === index);
  return element ? typingAt(element) : 0;
}

function typingAt(element: PositionedElement): number {
  if (element.type === "parenthetical") {
    const close = element.text.lastIndexOf(")");
    return element.from + (close >= 0 ? close : element.text.length);
  }
  return element.to;
}

function visibleOffset(element: PositionedElement, cursor: number): number {
  const into = Math.max(0, Math.min(element.text.length, cursor - element.from));
  if (element.type !== "parenthetical") return into;
  const start = element.text.startsWith("(") ? 1 : 0;
  const end = element.text.endsWith(")") ? element.text.length - 1 : element.text.length;
  return Math.max(0, Math.min(into, end) - start);
}

function placeOffset(element: PositionedElement, offset: number): number {
  if (element.type === "parenthetical" && element.text.startsWith("(")) {
    const end = element.text.endsWith(")") ? element.text.length - 1 : element.text.length;
    return element.from + 1 + Math.min(offset, Math.max(0, end - 1));
  }
  return element.from + Math.min(offset, element.text.length);
}

function unchanged(document: EditorDocument, cursor: number): Edit {
  return { document, cursor };
}
