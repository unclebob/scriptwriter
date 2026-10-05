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

export function enter(doc: string, cursor: number): Edit {
  const here = place(doc, cursor);
  if (here.line === "") {
    const prev = previousElement(doc, here.from);
    if (!prev) return setElement(doc, cursor, "scene");
    return enter(doc, prev.to);
  }
  const element = elementAt(doc, cursor);
  if (!element) return setElement(doc, cursor, "action");
  const next = returnNext(element.type);
  if (
    element.type === "scene" ||
    element.type === "character" ||
    element.type === "parenthetical" ||
    element.type === "transition" ||
    element.type === "act"
  ) {
    return insertAfter(doc, element, next, "");
  }
  const visibleAt = Math.max(0, here.offset - element.marker);
  let left = element.text.slice(0, visibleAt);
  let right = element.text.slice(visibleAt);
  if (right.startsWith(" ")) right = right.slice(1);
  else if (left.endsWith(" ")) left = left.slice(0, -1);
  const lines = texts(doc);
  const index = lineIndex(doc, element.from);
  if (left === "") {
    lines.splice(index, 1);
    return placeLine(lines, index - 1, next, right);
  }
  lines[index] = renderLine(element.type, left, false, underSpeech(lines, index));
  return placeLine(lines, index, next, right);
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
  const newlines = afterRaw.match(/^\n*/)?.[0].length ?? 0;
  const after = afterRaw.slice(newlines);
  const afterLead = Math.min(1, Math.max(0, newlines - 1));
  const parts: string[] = [];
  if (before) parts.push(before);
  if (block) {
    if (parts.length > 0 && lead > 0) parts.push("");
    parts.push(block);
  }
  if (after) {
    if (parts.length > 0 && afterLead > 0) parts.push("");
    parts.push(after);
  }
  const next = parts.join("\n").replace(/\n{3,}/g, "\n\n");
  if (next.trim() === "") return { doc: ".", cursor: 1 };
  let cursor: number;
  if (block) {
    cursor = (before ? before.length + (lead > 0 ? 2 : 1) : 0) + block.length;
  } else if (after) {
    cursor = before ? before.length + (afterLead > 0 ? 2 : 1) : 0;
  } else {
    cursor = before.length;
  }
  return { doc: next, cursor: Math.max(0, Math.min(cursor, next.length)) };
}

/** Case, markers, parentheses, and an action line that has become a slug. */
export function afterInput(doc: string, cursor: number): Edit {
  const here = place(doc, cursor);
  if (here.line === "") return { doc, cursor };
  const element = elementAt(doc, here.from);
  if (!element) return { doc, cursor };
  const lines = texts(doc);
  const index = lineIndex(doc, element.from);
  const nextIsText = index + 1 < lines.length && lines[index + 1] !== "";
  let type = element.type;
  if (type === "action" && /^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|INT\.|EXT\.)/i.test(element.text.trim())) {
    type = "scene";
  }
  if (type === "action" && isActLabel(element.text)) type = "act";
  const visible = element.text.replace(/\u200B/g, "");
  const rendered = renderLine(type, visible, nextIsText, underSpeech(lines, index));
  if (rendered === here.line) return { doc, cursor };
  const seen = here.line.slice(element.marker, here.offset).replace(/\u200B/g, "").length;
  lines[index] = rendered;
  const fresh = elementAt(join(lines), lineStart(lines, index)) ?? element;
  let offset = fresh.marker + Math.min(seen, fresh.text.length);
  if (fresh.type === "parenthetical") offset = Math.min(Math.max(offset, 1), Math.max(1, rendered.length - 1));
  return { doc: join(lines), cursor: lineStart(lines, index) + offset };
}

function insertAfter(doc: string, element: ScriptElement, type: ElementType, visible: string): Edit {
  const next = following(doc, element);
  const beside = next !== null && gap(doc, element.to, next.from) === 0;
  if (visible === "" && beside && next?.type === type) return { doc, cursor: typingAt(next) };
  if (type === "dialogue" && beside && next?.type === "parenthetical") return { doc, cursor: insideParen(next) };
  const lines = texts(doc);
  return placeLine(lines, lineIndex(doc, element.from), type, visible);
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
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return { doc: ".", cursor: 1 };
  const prev = previousLine(lines, Math.min(index, lines.length) - 1);
  if (index < lines.length && lines[index] !== "") {
    const kind = elementAt(join(lines), lineStart(lines, index));
    if (kind) normalizeBlanks(lines, index, kind.type);
  }
  const doc2 = join(lines);
  const target = elementAt(doc2, lineStart(lines, prev));
  return { doc: doc2, cursor: target ? target.to : lineStart(lines, prev) + lines[prev].length };
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
  let prev: ScriptElement | null = null;
  for (const element of parseScript(doc)) {
    if (element.from >= before) break;
    prev = element;
  }
  return prev;
}

function previousLine(lines: string[], from: number): number {
  let index = Math.max(0, from);
  while (index > 0 && lines[index] === "") index -= 1;
  return index;
}

function gap(doc: string, prevTo: number, from: number): number {
  const newlines = doc.slice(prevTo, from).match(/\n/g);
  return Math.max(0, (newlines?.length ?? 0) - 1);
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
