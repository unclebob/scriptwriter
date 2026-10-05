import {
  blanksBefore,
  elementAt,
  isActLabel,
  isBlankScript,
  parseScript,
  renderLine,
  returnNext,
  scriptLines,
  shiftTabType,
  tabType,
  underSpeech,
  type ElementType,
  type ScriptElement,
} from "./fountain";
import { docFromElements, elementsFromDoc } from "./script";

export type Edit = { doc: string; cursor: number };

const OPENS_NEXT = new Set<ElementType>(["scene", "character", "parenthetical", "transition", "act"]);

export function enter(doc: string, cursor: number): Edit {
  const here = place(doc, cursor);
  if (here.line === "") return enterBlank(doc, cursor, here.from);
  return splitElement(doc, cursor, here);
}

function enterBlank(doc: string, cursor: number, from: number): Edit {
  const prev = previousElement(doc, from);
  if (!prev) return setElement(doc, cursor, "scene");
  return enter(doc, prev.to);
}

function splitElement(doc: string, cursor: number, here: Here): Edit {
  const element = elementAt(doc, cursor);
  if (!element) return setElement(doc, cursor, "action");
  const next = returnNext(element.type);
  if (OPENS_NEXT.has(element.type)) return insertAfter(doc, element, next, "");
  return breakLine(doc, element, here, next);
}

function breakLine(doc: string, element: ScriptElement, here: Here, next: ElementType): Edit {
  const at = Math.max(0, here.offset - element.marker);
  const parts = trimBreak(element.text.slice(0, at), element.text.slice(at));
  const lines = texts(doc);
  const index = lineIndex(doc, element.from);
  if (parts.left === "") {
    lines.splice(index, 1);
    return placeLine(lines, index - 1, next, parts.right);
  }
  lines[index] = renderLine(element.type, parts.left, false, underSpeech(lines, index));
  return placeLine(lines, index, next, parts.right);
}

function trimBreak(left: string, right: string): { left: string; right: string } {
  if (right.startsWith(" ")) return { left, right: right.slice(1) };
  if (left.endsWith(" ")) return { left: left.slice(0, -1), right };
  return { left, right };
}

export function tab(doc: string, cursor: number): Edit {
  const here = place(doc, cursor);
  if (here.line === "") {
    const prev = previousElement(doc, here.from);
    if (!prev) return setElement(doc, cursor, "action");
    return tab(doc, prev.to);
  }
  const element = elementAt(doc, cursor);
  if (!element) return setElement(doc, cursor, "action");
  return convertLine(doc, element, tabType(element.type), cursor);
}

export function shiftTab(doc: string, cursor: number): Edit {
  const here = place(doc, cursor);
  if (here.line === "") {
    const prev = previousElement(doc, here.from);
    if (!prev) return { doc, cursor };
    return shiftTab(doc, prev.to);
  }
  const element = elementAt(doc, cursor);
  if (!element) return { doc, cursor };
  return convertLine(doc, element, shiftTabType(element.type));
}

/** An empty element of the same type, placed before the element at the cursor. */
export function insertBefore(doc: string, cursor: number): Edit {
  const element = elementBeside(doc, cursor);
  if (!element) return setElement(doc, cursor, "action");
  const lines = texts(doc);
  const index = lineIndex(doc, element.from);
  lines.splice(index, 0, renderLine(element.type, "", false));
  const newIndex = normalizeBlanks(lines, index, element.type);
  const nextIndex = nextContent(lines, newIndex + 1);
  if (nextIndex >= 0) {
    const kind = elementAt(join(lines), lineStart(lines, nextIndex));
    if (kind) normalizeBlanks(lines, nextIndex, kind.type);
  }
  return { doc: join(lines), cursor: typingCursor(lines, newIndex) };
}

export function setElement(doc: string, cursor: number, type: ElementType): Edit {
  const element = elementAt(doc, cursor);
  if (!element) {
    if (place(doc, cursor).line === "" && parseScript(doc).length > 0) return { doc, cursor };
    const lines = texts(doc);
    const here = place(doc, cursor);
    const index = lineIndexAt(doc, here.from);
    lines[index] = renderLine(type, "", false);
    const moved = normalizeBlanks(lines, index, type);
    return { doc: join(lines), cursor: typingCursor(lines, moved) };
  }
  return convertLine(doc, element, type);
}

/** Removes an empty element. Returns null when Backspace should delete a character. */
export function backspace(doc: string, cursor: number): Edit | null {
  const element = elementAt(doc, cursor);
  if (!element) return place(doc, cursor).line === "" ? { doc, cursor } : null;
  const atMarker = cursor <= element.from + element.marker;
  if (element.text === "") return removeElement(doc, element);
  if (atMarker) return { doc, cursor };
  return null;
}

/** Stops Delete at the end of an element. Returns null when Delete should delete a character. */
export function deleteForward(doc: string, cursor: number): Edit | null {
  const element = elementAt(doc, cursor);
  if (!element || cursor >= element.to) return { doc, cursor };
  return null;
}

/** True when a user edit would type on a blank line or join across a line break. */
export function structuralEdit(doc: string, from: number, to: number): boolean {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (place(doc, start).line === "") return true;
  return doc.slice(start, end).includes("\n");
}

/** Elements whose text the range touches. */
export function elementsCovered(doc: string, from: number, to: number): ScriptElement[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return [];
  return parseScript(doc).filter((element) => element.from < end && element.to > start);
}

/**
 * A selection inside one element stays put. A selection that reaches another
 * element grows to cover every element from the first through the last.
 */
export function elementSelection(doc: string, anchor: number, head: number): { anchor: number; head: number } | null {
  const covered = elementsCovered(doc, anchor, head);
  if (covered.length < 2) return null;
  const from = covered[0].from;
  const to = covered[covered.length - 1].to;
  const forward = head >= anchor;
  const nextAnchor = forward ? from : to;
  const nextHead = forward ? to : from;
  if (nextAnchor === anchor && nextHead === head) return null;
  return { anchor: nextAnchor, head: nextHead };
}

/** Removes every element the range touches, when that is more than one. */
export function deleteElements(doc: string, from: number, to: number): Edit | null {
  const covered = elementsCovered(doc, from, to);
  if (covered.length < 2) return null;
  const first = covered[0];
  const last = covered[covered.length - 1];
  return spliceBlock(doc, first.from, last.to, "", 0);
}

/** Inserts pasted elements. A span of elements is replaced. Otherwise the block follows the element at the cursor. */
export function insertElements(doc: string, from: number, to: number, pasted: string): Edit | null {
  const normalized = pasted.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.includes("\n")) return null;
  const incoming = elementsFromDoc(normalized);
  if (incoming.length === 0) return { doc, cursor: from };
  const block = docFromElements(incoming);
  const covered = elementsCovered(doc, from, to);
  if (covered.length >= 2) {
    const lead = blanksBefore(incoming[0].type);
    return spliceBlock(doc, covered[0].from, covered[covered.length - 1].to, block, lead);
  }
  if (isBlankScript(doc)) return { doc: block, cursor: block.length };
  const host = elementAt(doc, from) ?? previousElement(doc, Math.max(from, to));
  if (!host) return { doc: block, cursor: block.length };
  return spliceBlock(doc, host.to, host.to, block, blanksBefore(incoming[0].type));
}

function spliceBlock(doc: string, cutFrom: number, cutTo: number, block: string, lead: number): Edit {
  const before = doc.slice(0, cutFrom).replace(/\n+$/, "");
  const afterRaw = doc.slice(cutTo);
  const newlines = leadingNewlines(afterRaw);
  const after = afterRaw.slice(newlines);
  const afterLead = Math.min(1, Math.max(0, newlines - 1));
  const next = joined(before, block, lead, after, afterLead);
  if (next.trim() === "") return { doc: ".", cursor: 1 };
  const cursor = blockCursor(before, block, lead, after, afterLead);
  return { doc: next, cursor: Math.max(0, Math.min(cursor, next.length)) };
}

function leadingNewlines(text: string): number {
  const matched = text.match(/^\n*/);
  return matched ? matched[0].length : 0;
}

function joined(before: string, block: string, lead: number, after: string, afterLead: number): string {
  const parts: string[] = [];
  pushPiece(parts, before, 0);
  pushPiece(parts, block, lead);
  pushPiece(parts, after, afterLead);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n");
}

function pushPiece(parts: string[], piece: string, lead: number) {
  if (!piece) return;
  if (parts.length > 0 && lead > 0) parts.push("");
  parts.push(piece);
}

function blockCursor(before: string, block: string, lead: number, after: string, afterLead: number): number {
  if (block) return insertedCursor(before, block, lead);
  return removedCursor(before, after, afterLead);
}

function insertedCursor(before: string, block: string, lead: number): number {
  if (!before) return block.length;
  return before.length + (lead > 0 ? 2 : 1) + block.length;
}

function removedCursor(before: string, after: string, afterLead: number): number {
  if (!after) return before.length;
  if (!before) return 0;
  return before.length + (afterLead > 0 ? 2 : 1);
}

/** Case, markers, parentheses, and an action line that has become a slug. */
export function afterInput(doc: string, cursor: number): Edit {
  const here = place(doc, cursor);
  if (here.line === "") return { doc, cursor };
  const element = elementAt(doc, here.from);
  if (!element) return { doc, cursor };
  return normalizeLine(doc, element, here, cursor);
}

function normalizeLine(doc: string, element: ScriptElement, here: Here, cursor: number): Edit {
  const lines = texts(doc);
  const index = lineIndex(doc, element.from);
  const rendered = renderLine(
    promoted(element.type, element.text),
    element.text.replace(/\u200B/g, ""),
    followingText(lines, index),
    underSpeech(lines, index),
  );
  if (rendered === here.line) return { doc, cursor };
  lines[index] = rendered;
  return { doc: join(lines), cursor: lineStart(lines, index) + renderedOffset(element, here, rendered, lines, index) };
}

function followingText(lines: string[], index: number): boolean {
  return index + 1 < lines.length && lines[index + 1] !== "";
}

function promoted(type: ElementType, text: string): ElementType {
  if (type !== "action") return type;
  if (/^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|INT\.|EXT\.)/i.test(text.trim())) return "scene";
  if (isActLabel(text)) return "act";
  return type;
}

function renderedOffset(element: ScriptElement, here: Here, rendered: string, lines: string[], index: number): number {
  const seen = here.line.slice(element.marker, here.offset).replace(/\u200B/g, "").length;
  const fresh = elementAt(join(lines), lineStart(lines, index)) ?? element;
  const into = fresh.marker + Math.min(seen, fresh.text.length);
  if (fresh.type !== "parenthetical") return into;
  return Math.min(Math.max(into, 1), Math.max(1, rendered.length - 1));
}

function insertAfter(doc: string, element: ScriptElement, type: ElementType, visible: string): Edit {
  const reused = reusedCursor(touching(doc, element), type, visible);
  if (reused !== null) return { doc, cursor: reused };
  return placeLine(texts(doc), lineIndex(doc, element.from), type, visible);
}

function touching(doc: string, element: ScriptElement): ScriptElement | null {
  const next = following(doc, element);
  if (next && gap(doc, element.to, next.from) === 0) return next;
  return null;
}

function reusedCursor(next: ScriptElement | null, type: ElementType, visible: string): number | null {
  if (!next) return null;
  if (visible !== "") return null;
  return openCursor(next, type);
}

function openCursor(next: ScriptElement, type: ElementType): number | null {
  if (next.type === type) return typingAt(next);
  return parenCursor(next, type);
}

function parenCursor(next: ScriptElement, type: ElementType): number | null {
  if (type !== "dialogue") return null;
  return insideParenthetical(next);
}

function insideParenthetical(next: ScriptElement): number | null {
  if (next.type !== "parenthetical") return null;
  return insideParen(next);
}

function convertLine(doc: string, element: ScriptElement, type: ElementType, cursor?: number): Edit {
  const lines = texts(doc);
  let index = lineIndex(doc, element.from);
  const visible = carriedText(element, type);
  const nextIsText = index + 1 < lines.length && lines[index + 1] !== "";
  lines[index] = renderLine(type, visible, nextIsText, false);
  index = normalizeBlanks(lines, index, type);
  lines[index] = renderLine(type, visible, nextIsText, underSpeech(lines, index));
  const start = lineStart(lines, index);
  if (cursor === undefined) return { doc: join(lines), cursor: typingCursor(lines, index) };
  const fresh = elementAt(join(lines), start);
  if (!fresh) return { doc: join(lines), cursor: start };
  return { doc: join(lines), cursor: placeOffset(fresh, start, visibleOffset(element, cursor)) };
}

/** How many characters of the text, not counting a parenthetical's parentheses, sit before the cursor. */
function visibleOffset(element: ScriptElement, cursor: number): number {
  const into = Math.max(0, Math.min(element.text.length, cursor - element.from - element.marker));
  if (element.type !== "parenthetical") return into;
  const start = element.text.startsWith("(") ? 1 : 0;
  const end = element.text.endsWith(")") ? element.text.length - 1 : element.text.length;
  return Math.max(0, Math.min(into, end) - start);
}

function placeOffset(element: ScriptElement, start: number, into: number): number {
  if (element.type === "parenthetical" && element.text.startsWith("(")) {
    const end = element.text.endsWith(")") ? element.text.length - 1 : element.text.length;
    return start + Math.min(Math.max(into, 0), Math.max(0, end - 1)) + 1;
  }
  return start + element.marker + Math.min(into, element.text.length);
}

function carriedText(element: ScriptElement, type: ElementType): string {
  if (element.type === "parenthetical" && type !== "parenthetical") {
    return element.text.replace(/^\(/, "").replace(/\)$/, "");
  }
  return element.text;
}

function removeElement(doc: string, element: ScriptElement): Edit {
  const lines = texts(doc);
  const index = lineIndex(doc, element.from);
  lines.splice(index, 1);
  trimTrailing(lines);
  if (lines.length === 0) return { doc: ".", cursor: 1 };
  reblankFollowing(lines, index);
  return cursorAfterRemoval(lines, index);
}

function trimTrailing(lines: string[]) {
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
}

function reblankFollowing(lines: string[], index: number) {
  if (index >= lines.length || lines[index] === "") return;
  const kind = elementAt(join(lines), lineStart(lines, index));
  if (kind) normalizeBlanks(lines, index, kind.type);
}

function cursorAfterRemoval(lines: string[], index: number): Edit {
  const prev = previousLine(lines, Math.min(index, lines.length) - 1);
  const doc = join(lines);
  const target = elementAt(doc, lineStart(lines, prev));
  return { doc, cursor: target ? target.to : endOfLine(lines, prev) };
}

function endOfLine(lines: string[], index: number): number {
  return lineStart(lines, index) + lines[index].length;
}

function placeLine(lines: string[], after: number, type: ElementType, visible: string): Edit {
  const blanks = after < 0 ? 0 : blanksBefore(type);
  const speech = blanks === 0 && underSpeech(lines, after + 1);
  const addition = [...Array(blanks).fill(""), renderLine(type, visible, false, speech)];
  const index = after + 1 + blanks;
  lines.splice(after + 1, 0, ...addition);
  const where = visible === "" ? "typing" : "start";
  return { doc: join(lines), cursor: cursorOn(lines, index, where) };
}

function normalizeBlanks(lines: string[], index: number, type: ElementType): number {
  const want = index === 0 ? 0 : blanksBefore(type);
  let blanks = 0;
  let at = index - 1;
  while (at >= 0 && lines[at] === "") {
    blanks += 1;
    at -= 1;
  }
  if (blanks > want) {
    lines.splice(index - blanks, blanks - want);
    return index - (blanks - want);
  }
  if (blanks < want) {
    lines.splice(index, 0, ...Array(want - blanks).fill(""));
    return index + (want - blanks);
  }
  return index;
}

function cursorOn(lines: string[], index: number, where: "start" | "typing"): number {
  const element = elementAt(join(lines), lineStart(lines, index));
  if (!element) return lineStart(lines, index);
  if (element.type === "parenthetical" && element.text === "()") return element.from + 1;
  if (where === "start") return element.from + element.marker;
  return element.to;
}

function typingCursor(lines: string[], index: number): number {
  return cursorOn(lines, index, "typing");
}

function typingAt(element: ScriptElement): number {
  if (element.type === "parenthetical") return insideParen(element);
  return element.from + element.marker;
}

function insideParen(element: ScriptElement): number {
  const close = element.text.lastIndexOf(")");
  return element.from + (close > 0 ? close : element.text.length);
}

function elementBeside(doc: string, cursor: number): ScriptElement | null {
  const direct = elementAt(doc, cursor);
  if (direct) return direct;
  for (const element of parseScript(doc)) {
    if (element.from >= cursor) return element;
  }
  return null;
}

function nextContent(lines: string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index] !== "") return index;
  }
  return -1;
}

function following(doc: string, element: ScriptElement): ScriptElement | null {
  const elements = parseScript(doc);
  const index = elements.findIndex((item) => item.from === element.from);
  return elements[index + 1] ?? null;
}

function previousElement(doc: string, before: number): ScriptElement | null {
  return parseScript(doc).reduce<ScriptElement | null>((prev, element) => earlierElement(prev, element, before), null);
}

function earlierElement(prev: ScriptElement | null, element: ScriptElement, before: number): ScriptElement | null {
  if (element.from >= before) return prev;
  return element;
}

function previousLine(lines: string[], from: number): number {
  let index = Math.max(0, from);
  while (index > 0 && lines[index] === "") index -= 1;
  return index;
}

function gap(doc: string, prevTo: number, from: number): number {
  return Math.max(0, newlineCount(doc.slice(prevTo, from)) - 1);
}

function newlineCount(text: string): number {
  const matched = text.match(/\n/g);
  if (!matched) return 0;
  return matched.length;
}

type Here = { line: string; from: number; offset: number };

function place(doc: string, cursor: number): Here {
  const lines = scriptLines(doc);
  let line = lines[lines.length - 1];
  for (const item of lines) {
    if (cursor >= item.from && cursor <= item.to) {
      line = item;
      break;
    }
  }
  const offset = Math.max(0, Math.min(line.text.length, cursor - line.from));
  return { line: line.text, from: line.from, offset };
}

function texts(doc: string): string[] {
  return scriptLines(doc).map((line) => line.text);
}

function lineIndex(doc: string, from: number): number {
  return scriptLines(doc).findIndex((line) => line.from === from);
}

function lineIndexAt(doc: string, from: number): number {
  const index = lineIndex(doc, from);
  return index < 0 ? 0 : index;
}

function lineStart(lines: string[], index: number): number {
  let cursor = 0;
  for (let i = 0; i < index; i += 1) cursor += lines[i].length + 1;
  return cursor;
}

function join(lines: string[]): string {
  return lines.join("\n");
}
