import { blanksBefore, type ElementType } from "./elements";

export type ScriptElement = {
  type: ElementType;
  text: string;
  blanksBefore: 0 | 1;
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

export function snapshot(document: EditorDocument, revision = 0): DocumentSnapshot {
  const lines = sourceLines(document);
  const elements: PositionedElement[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.type === null) {
      blanks += 1;
      continue;
    }
    elements.push({
      type: line.type,
      text: line.text,
      blanksBefore: elements.length === 0 ? 0 : blanks > 0 ? 1 : 0,
      index: elements.length,
      line: line.number,
      from: line.from,
      to: line.to,
    });
    blanks = 0;
  }
  return { ...document, lineTypes: [...document.lineTypes], revision, elements };
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
  return document.elements.length === 1 && document.elements[0].type === "scene" && document.elements[0].text === "";
}

export function elementAt(document: DocumentSnapshot, cursor: number): PositionedElement | null {
  for (const element of document.elements) {
    if (cursor >= element.from && cursor <= element.to) return element;
  }
  return null;
}

export function lineAt(document: EditorDocument, cursor: number): SourceLine {
  const lines = sourceLines(document);
  const clipped = Math.max(0, Math.min(cursor, document.text.length));
  for (const line of lines) {
    if (clipped >= line.from && clipped <= line.to) return line;
  }
  return lines[lines.length - 1];
}

export function elementsDocument(elements: readonly ScriptElement[], revision = 0): DocumentSnapshot {
  return snapshot(editorDocument(elements), revision);
}

export function normalizeElements(
  elements: readonly { type: ElementType; text: string; blanksBefore?: number }[],
): ScriptElement[] {
  return elements.map((element, index) => ({
    type: element.type,
    text: element.text,
    blanksBefore: index === 0 ? 0 : element.blanksBefore === undefined ? blanksBefore(element.type) : element.blanksBefore > 0 ? 1 : 0,
  }));
}
