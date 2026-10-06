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

export const ELEMENT_KEY: ElementType[] = [...ELEMENTS];

const RETURN_NEXT: Record<ElementType, ElementType> = {
  scene: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "action",
  transition: "scene",
  shot: "action",
  act: "scene",
};

export function blanksBefore(type: ElementType): 0 | 1 {
  return type === "dialogue" || type === "parenthetical" ? 0 : 1;
}

export function cueName(visible: string): string {
  return visible.replace(/\([^)]*\)/g, "").trim();
}

export function returnNext(type: ElementType): ElementType {
  return RETURN_NEXT[type];
}

export function tabType(type: ElementType): ElementType {
  return ELEMENTS[(ELEMENTS.indexOf(type) + 1) % ELEMENTS.length];
}

export function shiftTabType(type: ElementType): ElementType {
  return ELEMENTS[(ELEMENTS.indexOf(type) - 1 + ELEMENTS.length) % ELEMENTS.length];
}

export function isElementType(value: string): value is ElementType {
  return (ELEMENTS as readonly string[]).includes(value);
}

export function formatText(type: ElementType, text: string): string {
  if (type === "parenthetical") return parenthesized(text);
  if (type === "scene" || type === "character" || type === "transition" || type === "shot" || type === "act") {
    return text.toUpperCase();
  }
  return text;
}

export function convertText(from: ElementType, to: ElementType, text: string): string {
  const carried = from === "parenthetical" && to !== "parenthetical" ? stripParenthetical(text) : text;
  return formatText(to, carried);
}

function stripParenthetical(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  return text.slice(1, -1);
}

function parenthesized(text: string): string {
  let inner = text;
  if (inner.startsWith("(")) inner = inner.slice(1);
  if (inner.endsWith(")")) inner = inner.slice(0, -1);
  return `(${inner})`;
}
