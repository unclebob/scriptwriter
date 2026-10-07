import type { DocumentSnapshot } from "../domain/document";
import type { ElementType } from "../domain/elements";

/** Lines under a one-inch top margin and above a one-inch bottom margin at 6 lines to the inch. */
export const LINES_PER_PAGE = 54;

const WIDTH: Record<ElementType, number> = {
  scene: 60,
  action: 60,
  character: 38,
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

type Remainder = { lines: string[]; chars: number[]; continuation: boolean };

export function paginate(document: DocumentSnapshot): Placed[][] {
  const blocks = blocksOf(document);
  const sheet: Sheet = { pages: [[]], used: 0 };
  for (let index = 0; index < blocks.length; index += 1) {
    placeBlock(sheet, blocks, index);
  }
  return finished(sheet.pages);
}

function finished(pages: Placed[][]): Placed[][] {
  const last = pages[pages.length - 1];
  if (last.length === 0) pages.pop();
  if (pages.length === 0) return [[]];
  return pages;
}

function placeBlock(sheet: Sheet, blocks: readonly Block[], index: number) {
  const block = blocks[index];
  const blanks = startBlanks(sheet, blocks, index);
  writeBlock(sheet, block, block.lines, block.chars, blanks);
}

function startBlanks(sheet: Sheet, blocks: readonly Block[], index: number): number {
  const block = blocks[index];
  const blanks = breakForAct(sheet, block);
  if (heldWithNext(sheet, blocks, index, blanks)) return 0;
  return blanks;
}

function breakForAct(sheet: Sheet, block: Block): number {
  if (block.type === "act" && sheet.used > 0) {
    newPage(sheet);
    return 0;
  }
  return sheet.used === 0 ? 0 : block.blanksBefore;
}

function heldWithNext(sheet: Sheet, blocks: readonly Block[], index: number, blanks: number): boolean {
  const block = blocks[index];
  const next = blocks[index + 1];
  if (!canHold(sheet, block, next)) return false;
  if (keepPage(sheet, blocks, index, blanks)) return false;
  newPage(sheet);
  return true;
}

function canHold(sheet: Sheet, block: Block, next: Block | undefined): next is Block {
  return keepsWithNext(block.type) && next !== undefined && sheet.used !== 0;
}

function keepPage(sheet: Sheet, blocks: readonly Block[], index: number, blanks: number): boolean {
  const block = blocks[index];
  const follow = followedLines(blocks, index);
  const group = blanks + block.lines.length + follow;
  const room = LINES_PER_PAGE - sheet.used;
  return group <= room || group > LINES_PER_PAGE;
}

function followedLines(blocks: readonly Block[], index: number): number {
  const next = blocks[index + 1];
  if (!next) return 0;
  const size = next.blanksBefore + next.lines.length;
  if (!keepsWithNext(next.type)) return Math.min(2, size);
  return size + followedLines(blocks, index + 1);
}

function writeBlock(sheet: Sheet, block: Block, lines: string[], chars: number[], blanks: number) {
  let rest = lines;
  let offsets = chars;
  let continuation = false;
  let first = true;
  while (rest.length !== 0) {
    const step = nextSlice(sheet, block, rest, offsets, blanks, continuation, first);
    rest = step.lines;
    offsets = step.chars;
    continuation = step.continuation;
    first = false;
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
}

function takeLines(sheet: Sheet, block: Block, lines: string[], chars: number[], continuation: boolean): Remainder {
  const continued = continuation && block.type === "dialogue";
  const budget = LINES_PER_PAGE - sheet.used - (continued ? 1 : 0);
  if (lines.length <= budget) {
    writeFit(sheet, block, lines, chars, continued);
    return { lines: [], chars: [], continuation };
  }
  return breakLines(sheet, block, lines, chars, budget, continued, continuation);
}

function writeFit(sheet: Sheet, block: Block, lines: string[], chars: number[], continued: boolean) {
  if (continued) put(sheet, contd(block, chars[0]));
  putLines(block, lines, chars, (line) => put(sheet, line));
}

function breakLines(
  sheet: Sheet,
  block: Block,
  lines: string[],
  chars: number[],
  budget: number,
  continued: boolean,
  continuation: boolean,
): Remainder {
  if (block.type === "dialogue") return breakDialogue(sheet, block, lines, chars, budget, continued);
  return { ...breakProse(sheet, block, lines, chars, budget), continuation };
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
    return { lines, chars, continuation: continued };
  }
  writeFit(sheet, block, lines.slice(0, room), chars.slice(0, room), continued);
  put(sheet, { text: "(MORE)", role: "more", source: moreSource(block, chars, room) });
  newPage(sheet);
  return { lines: lines.slice(room), chars: chars.slice(room), continuation: true };
}

function moreSource(block: Block, chars: number[], room: number): number {
  return sourceAt(block, chars[room]);
}

function breakProse(
  sheet: Sheet,
  block: Block,
  lines: string[],
  chars: number[],
  budget: number,
): { lines: string[]; chars: number[] } {
  if (budget === 0) {
    newPage(sheet);
    return { lines, chars };
  }
  putLines(block, lines.slice(0, budget), chars.slice(0, budget), (line) => put(sheet, line));
  return { lines: lines.slice(budget), chars: chars.slice(budget) };
}

function put(sheet: Sheet, line: Placed) {
  sheet.pages[sheet.pages.length - 1].push(line);
  sheet.used += 1;
}

function newPage(sheet: Sheet) {
  sheet.pages.push([]);
  sheet.used = 0;
}

export function pageAt(pages: readonly Placed[][], pos: number): { page: number; pages: number } {
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
export function pageStarts(pages: readonly Placed[][]): number[] {
  const starts: number[] = [];
  for (let i = 1; i < pages.length; i += 1) {
    const line = pages[i].find((item) => item.source !== undefined);
    if (line?.source !== undefined) starts.push(line.source);
  }
  return starts;
}

const CONTINUED = /\(cont['’]d\)/i;

export function withContd(name: string): string {
  if (CONTINUED.test(name)) return name;
  return `${name} (CONT'D)`;
}

function blocksOf(document: DocumentSnapshot): Block[] {
  const elements = document.elements;
  let speaker = "";
  return elements.map((element) => {
    if (element.type === "character" && element.text.trim()) speaker = element.text.trim();
    const wrapped = wrapTracked(element.text, WIDTH[element.type]);
    return {
      type: element.type,
      lines: wrapped.lines,
      chars: wrapped.chars,
      blanksBefore: element.blanksBefore,
      from: element.from,
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

function keepsWithNext(type: ElementType): boolean {
  return type === "scene" || type === "act" || type === "shot" || type === "character" || type === "parenthetical";
}

function sourceAt(block: Block, charIndex: number): number {
  return block.from + charIndex;
}

function contd(block: Block, charIndex: number): Placed {
  return { text: withContd(block.speaker), role: "character", source: sourceAt(block, charIndex) };
}

function putLines(block: Block, lines: string[], chars: number[], put: (line: Placed) => void) {
  for (let i = 0; i < lines.length; i += 1) {
    put({ text: lines[i], role: block.type, source: sourceAt(block, chars[i]) });
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
