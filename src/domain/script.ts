import { normalizeElements, type ScriptElement } from "./document";
import { isElementType, type ElementType } from "./elements";

export type Script = {
  root: string;
  title: string;
  credit: string;
  author: string;
  contact: string;
  draft: string;
  elements: ScriptElement[];
  warnings: string[];
};

type Header = Pick<Script, "title" | "credit" | "author" | "contact" | "draft">;

export type StoredElement = {
  type: ElementType;
  /** Text the writer sees. A parenthetical includes its parentheses. */
  text: string;
  /** 0 or 1 blank lines before this element. The first element has none. */
  blanksBefore?: number;
};

export function emptyScript(root: string): Script {
  return {
    root,
    title: "",
    credit: "Written by",
    author: "",
    contact: "",
    draft: "",
    elements: [],
    warnings: [],
  };
}

export function storedScript(root: string, text: string | null): Script {
  const script = emptyScript(root);
  if (text === null) {
    script.warnings.push("This folder has no script.json. The title page is empty.");
    return script;
  }
  const file = parseScriptJson(text);
  return { ...script, ...file, elements: normalizeElements(file.elements) };
}

export function serializeScript(script: Header & { elements: readonly ScriptElement[] }): string {
  const file = {
    title: script.title,
    credit: script.credit,
    author: script.author,
    draft: script.draft,
    contact: script.contact,
    elements: storedElements(script.elements),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseScriptJson(text: string): Header & { elements: StoredElement[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("script.json is not JSON.");
  }
  if (!isRecord(value)) throw new Error("script.json is not an object.");
  return {
    title: readString(value, "title", ""),
    credit: readString(value, "credit", "Written by"),
    author: readString(value, "author", ""),
    draft: readString(value, "draft", ""),
    contact: readString(value, "contact", ""),
    elements: readElements(value.elements),
  };
}

function storedElements(elements: readonly ScriptElement[]): StoredElement[] {
  if (elements.length === 1 && elements[0].type === "scene" && elements[0].text === "") return [];
  return elements.map((element, index) => {
    const stored: StoredElement = { type: element.type, text: element.text };
    if (index > 0) stored.blanksBefore = element.blanksBefore;
    return stored;
  });
}

function readElements(value: unknown): StoredElement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("script.json elements is not a list.");
  return value.map((item, index) => readElement(item, index));
}

function readElement(value: unknown, index: number): StoredElement {
  if (!isRecord(value)) throw new Error(`script.json element ${index + 1} is not an object.`);
  const type = elementType(value, index);
  const text = readString(value, "text", "");
  if (text.includes("\n")) throw new Error(`script.json element ${index + 1} is more than one line.`);
  return { type, text, ...readBlanks(value, index) };
}

function elementType(value: Record<string, unknown>, index: number): ElementType {
  const type = value.type;
  if (typeof type !== "string" || !isElementType(type)) {
    throw new Error(`script.json element ${index + 1} has an unknown type.`);
  }
  return type;
}

function readBlanks(value: Record<string, unknown>, index: number): { blanksBefore?: number } {
  if (!("blanksBefore" in value) || value.blanksBefore === undefined) return {};
  return { blanksBefore: blankCount(value.blanksBefore, index) };
}

function blankCount(value: unknown, index: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`script.json element ${index + 1} has a bad blanksBefore.`);
  }
  return Math.min(value, 1);
}

function readString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`script.json ${key} is not text.`);
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
