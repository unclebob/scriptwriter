import { elementAt, type DocumentSnapshot, type PositionedElement } from "../domain/document";
import { cueName } from "../domain/elements";

export const TRANSITIONS = [
  "CUT TO:",
  "DISSOLVE TO:",
  "SMASH CUT TO:",
  "MATCH CUT TO:",
  "FADE IN:",
  "FADE OUT.",
  "FADE TO BLACK.",
  "BACK TO:",
] as const;

export const EXTENSIONS = ["(V.O.)", "(O.S.)", "(O.C.)", "(CONT'D)", "(PRE-LAP)", "(FILTER)"] as const;

export type CompletionList = { from: number; to: number; options: string[] };

export function characterNames(document: DocumentSnapshot): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const element of document.elements) {
    if (element.type !== "character") continue;
    const name = cueName(element.text);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** The other person in the current scene, once two characters have spoken. */
export function otherSpeaker(document: DocumentSnapshot, before: number): string | null {
  return earlierSpeaker(speakersBefore(document, before));
}

function speakersBefore(document: DocumentSnapshot, before: number): string[] {
  const names: string[] = [];
  for (const element of document.elements) {
    if (element.from >= before) break;
    if (resetsSpeakers(element.type)) names.length = 0;
    rememberSpeaker(names, element);
  }
  return names;
}

function resetsSpeakers(type: string): boolean {
  return type === "scene" || type === "act";
}

function rememberSpeaker(names: string[], element: PositionedElement) {
  if (element.type !== "character") return;
  const name = cueName(element.text);
  if (name) names.push(name);
}

function earlierSpeaker(names: readonly string[]): string | null {
  if (names.length < 2) return null;
  return differentFromLast(names, names[names.length - 1]);
}

function differentFromLast(names: readonly string[], last: string): string | null {
  for (let index = names.length - 2; index >= 0; index -= 1) {
    if (names[index] !== last) return names[index];
  }
  return null;
}

export function completions(document: DocumentSnapshot, cursor: number): CompletionList | null {
  const element = elementAt(document, cursor);
  if (!element) return null;
  const at = cursor - element.from;
  if (at < 0) return null;
  if (element.type === "character") return characterList(document, element, at);
  if (element.type === "scene") return sceneList(document, element, at);
  if (element.type === "transition") return matching(TRANSITIONS, element.text.slice(0, at), element.from, element.to);
  return null;
}

function characterList(
  document: DocumentSnapshot,
  element: PositionedElement,
  at: number,
): CompletionList | null {
  const paren = element.text.indexOf("(");
  if (paren >= 0 && at >= paren) {
    const typed = element.text.slice(paren, at);
    return matching(EXTENSIONS, typed, element.from + paren, element.from + endOf(element.text, paren, ")"));
  }
  const baseEnd = paren >= 0 ? paren : element.text.length;
  const typed = element.text.slice(0, Math.min(at, baseEnd)).trim().toUpperCase();
  const other = otherSpeaker(document, element.from);
  const names = characterNames(document);
  const ordered = other ? [other, ...names.filter((name) => name !== other)] : names;
  return matching(ordered, typed, element.from, element.from + baseEnd);
}

function sceneList(document: DocumentSnapshot, element: PositionedElement, at: number): CompletionList | null {
  const typed = element.text.slice(0, Math.min(at, element.text.length)).trim().toUpperCase();
  const headings = sceneHeadings(document);
  const recent = latestSceneHeading(document, element.from);
  const ordered = recent ? [recent, ...headings.filter((heading) => heading !== recent)] : headings;
  return matching(ordered, typed, element.from, element.to);
}

function sceneHeadings(document: DocumentSnapshot): string[] {
  const seen = new Set<string>();
  const headings: string[] = [];
  for (const element of document.elements) {
    if (element.type !== "scene") continue;
    const heading = element.text.trim().toUpperCase();
    if (!heading || seen.has(heading)) continue;
    seen.add(heading);
    headings.push(heading);
  }
  return headings;
}

function latestSceneHeading(document: DocumentSnapshot, before: number): string | null {
  let latest: string | null = null;
  for (const element of document.elements) {
    if (element.from >= before) break;
    if (element.type !== "scene") continue;
    const heading = element.text.trim().toUpperCase();
    if (heading) latest = heading;
  }
  return latest;
}

function matching(pool: readonly string[], typed: string, from: number, to: number): CompletionList | null {
  const upper = typed.toUpperCase();
  const options = pool.filter((item) => item.startsWith(upper) && item !== upper);
  return options.length === 0 ? null : { from, to: Math.max(from, to), options };
}

function endOf(text: string, from: number, closer: string): number {
  const end = text.indexOf(closer, from);
  return end < 0 ? text.length : end + closer.length;
}
