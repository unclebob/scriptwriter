export const ELEMENTS = [
  "scene",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "shot",
  "act",
] as const;

export type ElementType = (typeof ELEMENTS)[number];

export const ELEMENT_LABEL: Record<ElementType, string> = {
  scene: "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  shot: "Shot",
  act: "Act",
};

export const ELEMENT_KEY: ElementType[] = [
  "scene",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "shot",
  "act",
];

export type ScriptLine = { text: string; from: number; to: number };

export type ScriptElement = {
  type: ElementType;
  /** Text the writer sees. A parenthetical includes its parentheses. */
  text: string;
  from: number;
  to: number;
  /** Characters at the start of the line that the editor hides. */
  marker: number;
};

const INTRO_RE = /^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|INT\.|EXT\.)/i;

const ACT_RE = /^ACT\s+(?:\d+|[IVXLCDM]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)$/i;

/** `ACT ONE`, `ACT I`, and `ACT 2`. Other act titles need the `#` marker. */
export function isActLabel(text: string): boolean {
  return ACT_RE.test(text.trim());
}

/** Blank lines before an element. Dialogue and a parenthetical sit on the next line. */
export function blanksBefore(type: ElementType): number {
  if (type === "dialogue" || type === "parenthetical") return 0;
  return 1;
}

export function returnNext(type: ElementType): ElementType {
  switch (type) {
    case "scene":
      return "action";
    case "action":
      return "action";
    case "character":
      return "dialogue";
    case "parenthetical":
      return "dialogue";
    case "dialogue":
      return "action";
    case "transition":
      return "scene";
    case "shot":
      return "action";
    case "act":
      return "scene";
  }
}

/** The next element. Tab walks this list and then returns to the scene heading. */
export function tabType(type: ElementType): ElementType {
  return ELEMENTS[(ELEMENTS.indexOf(type) + 1) % ELEMENTS.length];
}

/** The previous element. Shift-Tab walks the list the other way. */
export function shiftTabType(type: ElementType): ElementType {
  return ELEMENTS[(ELEMENTS.indexOf(type) - 1 + ELEMENTS.length) % ELEMENTS.length];
}

/** True when this line is directly under a character, a parenthetical, or dialogue. */
export function underSpeech(lines: string[], index: number): boolean {
  if (index <= 0 || lines[index - 1] === "") return false;
  let at = 0;
  for (let i = 0; i < index - 1; i += 1) at += lines[i].length + 1;
  const prev = elementAt(lines.join("\n"), at);
  return prev?.type === "character" || prev?.type === "parenthetical" || prev?.type === "dialogue";
}

export function scriptLines(doc: string): ScriptLine[] {
  const lines: ScriptLine[] = [];
  let from = 0;
  for (let i = 0; i <= doc.length; i += 1) {
    if (i !== doc.length && doc[i] !== "\n") continue;
    if (i === doc.length && from === doc.length && doc.endsWith("\n")) break;
    lines.push({ text: doc.slice(from, i), from, to: i });
    if (i === doc.length) break;
    from = i + 1;
  }
  if (lines.length === 0) lines.push({ text: "", from: 0, to: 0 });
  return lines;
}

export function parseScript(doc: string): ScriptElement[] {
  const lines = scriptLines(doc);
  const elements: ScriptElement[] = [];
  let prev: ElementType | null = null;
  let prevIndex = -2;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.text === "") continue;
    const adjacent = prevIndex === i - 1 && isSpeech(prev);
    const nextText = i + 1 < lines.length && lines[i + 1].text !== "";
    const kind = classify(line.text, adjacent, nextText);
    elements.push({
      type: kind.type,
      text: kind.text,
      marker: kind.marker,
      from: line.from,
      to: line.to,
    });
    prev = kind.type;
    prevIndex = i;
  }
  return elements;
}

export function elementAt(doc: string, cursor: number): ScriptElement | null {
  for (const element of parseScript(doc)) {
    if (cursor >= element.from && cursor <= element.to) return element;
  }
  return null;
}

export function sceneHeadings(doc: string): { text: string; from: number }[] {
  return parseScript(doc)
    .filter((element) => element.type === "scene")
    .map((element) => ({ text: element.text || "Scene", from: element.from }));
}

/** An empty editor, or a file that is only an empty scene heading. */
export function isBlankScript(doc: string): boolean {
  const elements = parseScript(doc);
  return elements.length === 0 || (elements.length === 1 && elements[0].type === "scene" && elements[0].text === "");
}

export function renderLine(type: ElementType, visible: string, nextIsText = false, underSpeech = false): string {
  const text = cased(type, visible);
  switch (type) {
    case "character":
      return `@${text}`;
    case "shot":
      return `~${text}`;
    case "transition":
      return isTransition(text) || text === "" ? text || ">" : `>${text}`;
    case "scene":
      return sceneSource(text);
    case "parenthetical":
      return parenSource(text);
    case "dialogue": {
      const body = text.replace(/\u200B/g, "");
      if (underSpeech && body !== "") return body;
      return `\u200B${body}`;
    }
    case "action":
      return actionSource(text, nextIsText);
    case "act":
      return actSource(text);
  }
}

export function editorDoc(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.trim() === "") return ".";
  return normalized.replace(/\n$/, "");
}

function isSpeech(type: ElementType | null): boolean {
  return type === "character" || type === "parenthetical" || type === "dialogue";
}

function classify(
  line: string,
  adjacent: boolean,
  nextText: boolean,
): { type: ElementType; text: string; marker: number } {
  if (line.startsWith("\u200B")) {
    return { type: "dialogue", text: line.slice(1).replace(/\u200B/g, ""), marker: 1 };
  }
  if (line.startsWith("@")) return { type: "character", text: line.slice(1), marker: 1 };
  if (line.startsWith(">")) return { type: "transition", text: line.slice(1), marker: 1 };
  if (line.startsWith("~")) return { type: "shot", text: line.slice(1), marker: 1 };
  if (line.startsWith("!")) return { type: "action", text: line.slice(1), marker: 1 };
  if (line.startsWith("#")) return { type: "act", text: line.slice(1), marker: 1 };
  if (line === "." || /^\.[^.]/.test(line)) return { type: "scene", text: line.slice(1), marker: 1 };
  if (INTRO_RE.test(line)) return { type: "scene", text: line, marker: 0 };
  if (isActLabel(line)) return { type: "act", text: line.trim(), marker: 0 };
  if (isTransition(line)) return { type: "transition", text: line, marker: 0 };
  if (/^\(.*\)$/.test(line)) return { type: "parenthetical", text: line, marker: 0 };
  if (adjacent && line.startsWith("(")) return { type: "parenthetical", text: line, marker: 0 };
  if (adjacent) return { type: "dialogue", text: line.replace(/\u200B/g, ""), marker: 0 };
  if (nextText && looksLikeCue(line)) return { type: "character", text: line, marker: 0 };
  if (isAllCaps(line) && line.length <= 50) return { type: "shot", text: line, marker: 0 };
  return { type: "action", text: line, marker: 0 };
}

function cased(type: ElementType, visible: string): string {
  if (type === "scene" || type === "character" || type === "transition" || type === "shot" || type === "act") {
    return visible.toUpperCase();
  }
  return visible;
}

function actSource(text: string): string {
  if (isActLabel(text)) return text;
  if (text.startsWith("#")) return text;
  return `#${text}`;
}

function sceneSource(text: string): string {
  if (text === "") return ".";
  if (INTRO_RE.test(text)) return text;
  if (text.startsWith(".")) return text;
  return `.${text}`;
}

function parenSource(text: string): string {
  let inner = text.trim();
  if (inner.startsWith("(")) inner = inner.slice(1);
  if (inner.endsWith(")")) inner = inner.slice(0, -1);
  return `(${inner})`;
}

function actionSource(text: string, nextIsText: boolean): string {
  if (text === "" || needsForce(text, nextIsText)) return `!${text.replace(/^!/, "")}`;
  return text;
}

function needsForce(text: string, nextIsText: boolean): boolean {
  if (text.startsWith("@") || text.startsWith(">") || text.startsWith("~") || text.startsWith("!") || text.startsWith("#")) return true;
  if (isActLabel(text)) return true;
  if (text === "." || /^\.[^.]/.test(text)) return true;
  if (INTRO_RE.test(text)) return true;
  if (isTransition(text)) return true;
  if (/^\(.*\)$/.test(text)) return true;
  if (nextIsText && looksLikeCue(text)) return true;
  if (!nextIsText && isAllCaps(text) && text.length <= 50) return true;
  return false;
}

function isTransition(line: string): boolean {
  if (!isAllCaps(line)) return false;
  const text = line.trim();
  return /TO:$/.test(text) || text === "FADE OUT." || text === "FADE TO BLACK." || text === "FADE TO WHITE." || text === "FADE IN:";
}

function isAllCaps(line: string): boolean {
  let letter = false;
  for (const char of line) {
    if (char.toLowerCase() === char.toUpperCase()) continue;
    letter = true;
    if (char !== char.toUpperCase()) return false;
  }
  return letter;
}

function looksLikeCue(line: string): boolean {
  if (line.length === 0 || line.length > 40) return false;
  return /^@?[A-Z][A-Z0-9 .'\-]*(\([^)]*\))*$/.test(line);
}
