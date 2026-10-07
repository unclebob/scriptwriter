import { blanksBefore, type ElementType } from "./elements";

export type ScriptElement = {
  type: ElementType;
  text: string;
  blanksBefore: number;
};

export type LineType = ElementType | null;

export type EditorDocument = {
  text: string;
  lineTypes: readonly LineType[];
};

export type PositionedElement = ScriptElement & {
  index: number;
  line: number;
  from: number;
  to: number;
};

export type DocumentSnapshot = EditorDocument & {
  revision: number;
  elements: readonly PositionedElement[];
};

export type SourceLine = {
  number: number;
  text: string;
  type: LineType;
  from: number;
  to: number;
};

export function editorDocument(elements: readonly ScriptElement[]): EditorDocument {
  if (elements.length === 0) return { text: "", lineTypes: ["scene"] };
  const lines: string[] = [];
  const lineTypes: LineType[] = [];
  elements.forEach((element, index) => {
    const blanks = index === 0 ? 0 : element.blanksBefore;
    for (let count = 0; count < blanks; count += 1) {
      lines.push("");
      lineTypes.push(null);
    }
    lines.push(element.text);
    lineTypes.push(element.type);
  });
  return { text: lines.join("\n"), lineTypes };
}

export function snapshot(document: EditorDocument, revision?: number): DocumentSnapshot {
  const storedRevision = revision === undefined ? 0 : revision;
  const lines = sourceLines(document);
  const elements: PositionedElement[] = [];
  let blanks = 0;
  let started = false;
  for (const line of lines) {
    if (line.type === null) {
      if (started) blanks += 1;
      continue;
    }
    const blanksBefore = storedBlanks(blanks);
    elements.push({
      type: line.type,
      text: line.text,
      blanksBefore,
      index: elements.length,
      line: line.number,
      from: line.from,
      to: line.to,
    });
    started = true;
    blanks = 0;
  }
  return { ...document, lineTypes: [...document.lineTypes], revision: storedRevision, elements };
}

function storedBlanks(blanks: number) {
  if (blanks > 0) return 1;
  return 0;
}

export function sourceLines(document: EditorDocument): SourceLine[] {
  const textLines = document.text.split("\n");
  if (textLines.length !== document.lineTypes.length) {
    throw new Error(`Document has ${textLines.length} lines but ${document.lineTypes.length} line types.`);
  }
  const lines: SourceLine[] = [];
  let from = 0;
  for (let index = 0; index < textLines.length; index += 1) {
    const text = textLines[index];
    lines.push({ number: index, text, type: document.lineTypes[index], from, to: from + text.length });
    from += text.length + 1;
  }
  return lines;
}

export function storableElements(document: DocumentSnapshot): ScriptElement[] {
  if (isOpeningPlaceholder(document)) return [];
  return document.elements.map(({ type, text, blanksBefore }) => ({ type, text, blanksBefore }));
}

export function isOpeningPlaceholder(document: DocumentSnapshot): boolean {
  if (document.elements.length !== 1) return false;
  const element = document.elements[0];
  return element.type === "scene" && element.text === "";
}

export function elementAt(document: DocumentSnapshot, cursor: number): PositionedElement | null {
  for (const element of document.elements) {
    if (cursor >= element.from && cursor <= element.to) return element;
  }
  return null;
}

export function lineAt(document: EditorDocument, cursor: number): SourceLine {
  const lines = sourceLines(document);
  const clipped = Math.max(0, cursor);
  for (const line of lines) {
    if (clipped >= line.from && clipped <= line.to) return line;
  }
  const last = lines.length - 1;
  return lines[last];
}

export function elementsDocument(elements: readonly ScriptElement[], revision?: number): DocumentSnapshot {
  const storedRevision = revision === undefined ? 0 : revision;
  return snapshot(editorDocument(elements), storedRevision);
}

export function normalizeElements(
  elements: readonly { type: ElementType; text: string; blanksBefore?: number }[],
): ScriptElement[] {
  return elements.map((element, index) => ({
    type: element.type,
    text: element.text,
    blanksBefore: normalizedBlanks(index, element.blanksBefore, element.type),
  }));
}

function normalizedBlanks(index: number, blanks: number | undefined, type: ElementType) {
  if (index === 0) return 0;
  if (blanks === undefined) return blanksBefore(type);
  if (blanks > 0) return 1;
  return 0;
}
