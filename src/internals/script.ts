import { blanksBefore, ELEMENTS, isBlankScript, parseScript, renderLine, type ElementType } from "./fountain";
import { joinPath } from "./path";

export type Fs = {
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
};

export type Script = {
  root: string;
  title: string;
  credit: string;
  author: string;
  contact: string;
  draft: string;
  body: string;
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

const SCRIPT_FILE = "script.json";

export function emptyScript(root: string): Script {
  return { root, title: "", credit: "Written by", author: "", contact: "", draft: "", body: "", warnings: [] };
}

export async function loadScript(fs: Fs, root: string): Promise<Script> {
  const script = emptyScript(root);
  const text = await readOptional(fs, joinPath(root, SCRIPT_FILE));
  if (text === null) {
    script.warnings.push("This folder has no script.json. The title page is empty.");
    return script;
  }
  const file = parseScriptJson(text);
  script.title = file.title;
  script.credit = file.credit;
  script.author = file.author;
  script.draft = file.draft;
  script.contact = file.contact;
  script.body = docFromElements(file.elements);
  script.root = root;
  return script;
}

export async function saveScript(fs: Fs, script: Script): Promise<void> {
  await fs.writeText(joinPath(script.root, SCRIPT_FILE), serializeScript(script));
}

export function serializeScript(script: Header & { body: string }): string {
  const file = {
    title: script.title,
    credit: script.credit,
    author: script.author,
    draft: script.draft,
    contact: script.contact,
    elements: elementsFromDoc(script.body),
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

export function elementsFromDoc(doc: string): StoredElement[] {
  if (isBlankScript(doc)) return [];
  const elements = parseScript(doc);
  return elements.map((element, index) => {
    const stored: StoredElement = { type: element.type, text: element.text };
    if (index > 0) stored.blanksBefore = blanksBetween(doc, elements[index - 1].to, element.from);
    return stored;
  });
}

export function docFromElements(elements: StoredElement[]): string {
  if (elements.length === 0) return "";
  const lines: string[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const gap = leadingBlanks(element, index);
    for (let i = 0; i < gap; i += 1) lines.push("");
    const next = elements[index + 1];
    const nextIsText = next !== undefined && leadingBlanks(next, index + 1) === 0;
    const prev = index === 0 ? null : elements[index - 1].type;
    const underSpeech = gap === 0 && isSpeech(prev);
    lines.push(renderLine(element.type, element.text, nextIsText, underSpeech));
  }
  return lines.join("\n");
}

function leadingBlanks(element: StoredElement, index: number): number {
  if (index === 0) return 0;
  return element.blanksBefore ?? blanksBefore(element.type);
}

function blanksBetween(doc: string, prevTo: number, from: number): number {
  const newlines = doc.slice(prevTo, from).match(/\n/g)?.length ?? 0;
  return Math.max(0, newlines - 1) > 0 ? 1 : 0;
}

function isSpeech(type: ElementType | null): boolean {
  return type === "character" || type === "parenthetical" || type === "dialogue";
}

function readElements(value: unknown): StoredElement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("script.json elements is not a list.");
  return value.map((item, index) => readElement(item, index));
}

function readElement(value: unknown, index: number): StoredElement {
  if (!isRecord(value)) throw new Error(`script.json element ${index + 1} is not an object.`);
  const type = value.type;
  if (typeof type !== "string" || !isElementType(type)) {
    throw new Error(`script.json element ${index + 1} has an unknown type.`);
  }
  const text = readString(value, "text", "");
  if (text.includes("\n")) throw new Error(`script.json element ${index + 1} is more than one line.`);
  const element: StoredElement = { type, text };
  if ("blanksBefore" in value && value.blanksBefore !== undefined) {
    const blanks = value.blanksBefore;
    if (typeof blanks !== "number" || !Number.isInteger(blanks) || blanks < 0) {
      throw new Error(`script.json element ${index + 1} has a bad blanksBefore.`);
    }
    element.blanksBefore = Math.min(blanks, 1);
  }
  return element;
}

function readString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`script.json ${key} is not text.`);
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isElementType(value: string): value is ElementType {
  return (ELEMENTS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOptional(fs: Fs, path: string): Promise<string | null> {
  try {
    return await fs.readText(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function missing(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /not found|os error 2|No such file/i.test(message);
}
