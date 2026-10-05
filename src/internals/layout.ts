import { cueName } from "./smarttype";
import { parseScript, type ElementType } from "./fountain";

/** Lines under a one-inch top margin and above a one-inch bottom margin at 6 lines to the inch. */
export const LINES_PER_PAGE = 54;

const WIDTH: Record<ElementType, number> = {
  scene: 60,
  action: 60,
  character: 60,
  parenthetical: 25,
  dialogue: 35,
  transition: 60,
  shot: 60,
  act: 60,
};

export type PlacedRole = ElementType | "more" | "blank";

export type Placed = {
  text: string;
  role: PlacedRole;
  /** Offset in the source of the text this line shows. Blank lines omit it. */
  source?: number;
};

type Block = {
  type: ElementType;
  lines: string[];
  /** Visible-text index where each wrapped line starts. */
  chars: number[];
  blanksBefore: number;
  from: number;
  marker: number;
  speaker: string;
};

export function wrapText(text: string, width: number): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current.length === 0) {
      current = breakWord(word, width, lines);
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = breakWord(word, width, lines);
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

type Sheet = { pages: Placed[][]; used: number };

type Remainder = { lines: string[]; chars: number[]; continuation: boolean; done: boolean };

export function paginate(doc: string): Placed[][] {
  const blocks = blocksOf(doc);
  const sheet: Sheet = { pages: [[]], used: 0 };
  for (let index = 0; index < blocks.length; index += 1) {
    placeBlock(sheet, blocks[index], blocks[index + 1] ?? null);
  }
  return finished(sheet.pages);
}

function finished(pages: Placed[][]): Placed[][] {
  if (pages.length > 1 && lastPageEmpty(pages)) pages.pop();
  if (pages.length === 0) return [[]];
  return pages;
}

function lastPageEmpty(pages: Placed[][]): boolean {
  return pages[pages.length - 1].length === 0;
}

function placeBlock(sheet: Sheet, block: Block, next: Block | null) {
  const blanks = startBlanks(sheet, block, next);
  writeBlock(sheet, block, block.lines, block.chars, blanks);
}

function startBlanks(sheet: Sheet, block: Block, next: Block | null): number {
  const blanks = breakForAct(sheet, block);
  if (heldWithNext(sheet, block, next, blanks)) return 0;
  return blanks;
}

function breakForAct(sheet: Sheet, block: Block): number {
  if (block.type === "act" && sheet.used > 0) {
    newPage(sheet);
    return 0;
  }
  return sheet.used === 0 ? 0 : block.blanksBefore;
}

function heldWithNext(sheet: Sheet, block: Block, next: Block | null, blanks: number): boolean {
  if (!canHold(sheet, block, next)) return false;
  if (keepPage(sheet, block, next, blanks)) return false;
  newPage(sheet);
  return true;
}

function canHold(sheet: Sheet, block: Block, next: Block | null): next is Block {
  return keepsWithNext(block.type) && next !== null && sheet.used > 0;
}

function keepPage(sheet: Sheet, block: Block, next: Block, blanks: number): boolean {
  const follow = Math.min(2, next.blanksBefore + next.lines.length);
  const group = blanks + block.lines.length + follow;
  const room = LINES_PER_PAGE - sheet.used;
  return group <= room || group > LINES_PER_PAGE;
}

function writeBlock(sheet: Sheet, block: Block, lines: string[], chars: number[], blanks: number) {
  let rest = lines;
  let offsets = chars;
  let pending = blanks;
  let continuation = false;
  let first = true;
  while (rest.length > 0) {
    const step = nextSlice(sheet, block, rest, offsets, pending, continuation, first);
    rest = step.lines;
    offsets = step.chars;
    continuation = step.continuation;
    pending = 0;
    first = false;
    if (step.done) return;
  }
}

function nextSlice(
  sheet: Sheet,
  block: Block,
  lines: string[],
  chars: number[],
  blanks: number,
  continuation: boolean,
  first: boolean,
): Remainder {
  if (sheet.used === LINES_PER_PAGE) newPage(sheet);
  if (first) placeBlanks(sheet, blanks);
  return takeLines(sheet, block, lines, chars, continuation);
}

function placeBlanks(sheet: Sheet, blanks: number) {
  let left = blanks;
  while (left > 0 && sheet.used < LINES_PER_PAGE) {
    put(sheet, { text: "", role: "blank" });
    left -= 1;
  }
  if (left > 0) newPage(sheet);
}

function takeLines(sheet: Sheet, block: Block, lines: string[], chars: number[], continuation: boolean): Remainder {
  const continued = continuation && block.type === "dialogue";
  const budget = LINES_PER_PAGE - sheet.used - (continued ? 1 : 0);
  if (lines.length <= budget) {
    writeFit(sheet, block, lines, chars, continued);
    return { lines: [], chars: [], continuation, done: true };
  }
  return breakLines(sheet, block, lines, chars, budget, continued);
}

function writeFit(sheet: Sheet, block: Block, lines: string[], chars: number[], continued: boolean) {
  if (continued) put(sheet, contd(block, chars[0] ?? 0));
  putLines(block, lines, chars, (line) => put(sheet, line));
}

function breakLines(
  sheet: Sheet,
  block: Block,
  lines: string[],
  chars: number[],
  budget: number,
  continued: boolean,
): Remainder {
  if (block.type === "dialogue") return breakDialogue(sheet, block, lines, chars, budget, continued);
  return breakProse(sheet, block, lines, chars, budget);
}

function breakDialogue(
  sheet: Sheet,
  block: Block,
  lines: string[],
  chars: number[],
  budget: number,
  continued: boolean,
): Remainder {
  const room = budget - 1;
  if (room < 1) {
    newPage(sheet);
    return { lines, chars, continuation: continued, done: false };
  }
  writeFit(sheet, block, lines.slice(0, room), chars.slice(0, room), continued);
  put(sheet, { text: "(MORE)", role: "more", source: moreSource(block, chars, room) });
  newPage(sheet);
  return { lines: lines.slice(room), chars: chars.slice(room), continuation: true, done: false };
}

function moreSource(block: Block, chars: number[], room: number): number {
  return sourceAt(block, chars[room] ?? block.lines.join("").length);
}

function breakProse(sheet: Sheet, block: Block, lines: string[], chars: number[], budget: number): Remainder {
  if (budget < 1) {
    newPage(sheet);
    return { lines, chars, continuation: false, done: false };
  }
  putLines(block, lines.slice(0, budget), chars.slice(0, budget), (line) => put(sheet, line));
  return { lines: lines.slice(budget), chars: chars.slice(budget), continuation: false, done: false };
}

function put(sheet: Sheet, line: Placed) {
  sheet.pages[sheet.pages.length - 1].push(line);
  sheet.used += 1;
}

function newPage(sheet: Sheet) {
  sheet.pages.push([]);
  sheet.used = 0;
}

export function pageAt(doc: string, pos: number): { page: number; pages: number } {
  const pages = paginate(doc);
  let page = 1;
  let best = -1;
  for (let i = 0; i < pages.length; i += 1) {
    for (const line of pages[i]) {
      if (line.source === undefined || line.source > pos || line.source < best) continue;
      best = line.source;
      page = i + 1;
    }
  }
  return { page, pages: Math.max(pages.length, 1) };
}

/** Source offsets where a page after the first one begins. */
export function pageStarts(doc: string): number[] {
  const pages = paginate(doc);
  const starts: number[] = [];
  for (let i = 1; i < pages.length; i += 1) {
    const line = pages[i].find((item) => item.source !== undefined);
    if (line?.source !== undefined) starts.push(line.source);
  }
  return starts;
}

export function withContd(name: string): string {
  if (/\(CONT'D\)/.test(name)) return name;
  return `${name} (CONT'D)`;
}

function blocksOf(doc: string): Block[] {
  const elements = parseScript(doc);
  let speaker = "";
  return elements.map((element, index) => {
    if (element.type === "character" && element.text.trim()) speaker = element.text.trim();
    const wrapped = wrapTracked(element.text, WIDTH[element.type]);
    return {
      type: element.type,
      lines: wrapped.lines,
      chars: wrapped.chars,
      blanksBefore: leadingBlanks(doc, elements, index),
      from: element.from,
      marker: element.marker,
      speaker,
    };
  });
}

function wrapTracked(text: string, width: number): { lines: string[]; chars: number[] } {
  const lines = wrapText(text, width);
  const chars: number[] = [];
  let at = 0;
  for (const line of lines) {
    chars.push(at);
    at += line.length;
    if (text[at] === " ") at += 1;
  }
  return { lines, chars };
}

function leadingBlanks(doc: string, elements: { to: number; from: number }[], index: number): number {
  if (index === 0) return 0;
  return blankCount(doc, elements[index - 1].to, elements[index].from);
}

function blankCount(doc: string, prevTo: number, from: number): number {
  const newlines = doc.slice(prevTo, from).match(/\n/g);
  return Math.max(0, (newlines?.length ?? 0) - 1);
}

function keepsWithNext(type: ElementType): boolean {
  return type === "scene" || type === "act" || type === "shot" || type === "character" || type === "parenthetical";
}

function sourceAt(block: Block, charIndex: number): number {
  return block.from + block.marker + charIndex;
}

function contd(block: Block, charIndex: number): Placed {
  return { text: withContd(block.speaker || cueName(block.speaker)), role: "character", source: sourceAt(block, charIndex) };
}

function putLines(block: Block, lines: string[], chars: number[], put: (line: Placed) => void) {
  for (let i = 0; i < lines.length; i += 1) {
    put({ text: lines[i], role: block.type, source: sourceAt(block, chars[i] ?? 0) });
  }
}

function breakWord(word: string, width: number, lines: string[]): string {
  let rest = word;
  while (rest.length > width) {
    lines.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  return rest;
}
