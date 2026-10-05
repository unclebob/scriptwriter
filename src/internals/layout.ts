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

export function paginate(doc: string): Placed[][] {
  const blocks = blocksOf(doc);
  const pages: Placed[][] = [[]];
  let used = 0;

  function put(line: Placed) {
    pages[pages.length - 1].push(line);
    used += 1;
  }

  function newPage() {
    pages.push([]);
    used = 0;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    placeBlock(blocks[index], blocks[index + 1] ?? null);
  }

  function placeBlock(block: Block, next: Block | null) {
    let lines = block.lines;
    let chars = block.chars;
    let blanks = used === 0 ? 0 : block.blanksBefore;
    if (block.type === "act" && used > 0) {
      newPage();
      blanks = 0;
    }
    if (keepsWithNext(block.type) && next && used > 0) {
      const follow = Math.min(2, next.blanksBefore + next.lines.length);
      const group = blanks + lines.length + follow;
      const room = LINES_PER_PAGE - used;
      if (group > room && group <= LINES_PER_PAGE) {
        newPage();
        blanks = 0;
      }
    }
    let continuation = false;
    let first = true;
    while (lines.length > 0) {
      if (used === LINES_PER_PAGE) newPage();
      if (first) {
        while (blanks > 0 && used < LINES_PER_PAGE) {
          put({ text: "", role: "blank" });
          blanks -= 1;
        }
        if (blanks > 0) {
          newPage();
          blanks = 0;
        }
        first = false;
      }
      const continued = continuation && block.type === "dialogue";
      const budget = LINES_PER_PAGE - used - (continued ? 1 : 0);
      if (lines.length <= budget) {
        if (continued) put(contd(block, chars[0] ?? 0));
        putLines(block, lines, chars, put);
        return;
      }
      if (block.type === "dialogue") {
        const room = budget - 1;
        if (room < 1) {
          newPage();
          continue;
        }
        if (continued) put(contd(block, chars[0] ?? 0));
        putLines(block, lines.slice(0, room), chars.slice(0, room), put);
        put({ text: "(MORE)", role: "more", source: sourceAt(block, chars[room] ?? block.lines.join("").length) });
        lines = lines.slice(room);
        chars = chars.slice(room);
        newPage();
        continuation = true;
        continue;
      }
      if (budget < 1) {
        newPage();
        continue;
      }
      putLines(block, lines.slice(0, budget), chars.slice(0, budget), put);
      lines = lines.slice(budget);
      chars = chars.slice(budget);
    }
  }

  if (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  return pages.length === 0 ? [[]] : pages;
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
      blanksBefore: index === 0 ? 0 : blankCount(doc, elements[index - 1].to, element.from),
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
