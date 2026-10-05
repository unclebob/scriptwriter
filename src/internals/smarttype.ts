import { elementAt, parseScript, type ScriptElement } from "./fountain";

export const INTROS = ["INT./EXT.", "EXT./INT.", "INT.", "EXT.", "I/E."] as const;

export const TIMES = [
  "DAY",
  "NIGHT",
  "MORNING",
  "AFTERNOON",
  "EVENING",
  "LATER",
  "CONTINUOUS",
  "MOMENTS LATER",
  "SAME",
  "SUNRISE",
  "SUNSET",
  "DAWN",
  "DUSK",
] as const;

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

const INTRO_RE = /^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|INT\.|EXT\.)/i;

export type SceneParts = {
  intro: string;
  location: string;
  time: string;
  introEnd: number;
  locationStart: number;
  locationEnd: number;
  timeStart: number;
};

export type Zone = "intro" | "location" | "time";

export type CompletionList = { from: number; to: number; options: string[] };

export function sceneParts(visible: string): SceneParts {
  const matched = INTRO_RE.exec(visible);
  const intro = matched ? matched[1].toUpperCase() : "";
  const rest = visible.slice(intro.length);
  const lead = rest.length - rest.trimStart().length;
  const body = rest.trimStart();
  const separated = /\s+-\s+/.exec(body);
  const location = separated ? body.slice(0, separated.index) : body;
  const time = separated ? body.slice(separated.index + separated[0].length) : "";
  const locationStart = intro.length + lead;
  const locationEnd = locationStart + location.length;
  const timeStart = separated ? intro.length + lead + separated.index + separated[0].length : visible.length;
  return { intro, location, time, introEnd: intro.length, locationStart, locationEnd, timeStart };
}

export function sceneZone(parts: SceneParts, offset: number): Zone {
  if (parts.timeStart > parts.locationEnd && offset >= parts.timeStart) return "time";
  if (!parts.intro) return "location";
  if (offset <= parts.introEnd || offset < parts.locationStart) return "intro";
  return "location";
}

/** Tab through the three parts of a slug. `leave` means the time of day is done. */
export function tabScene(visible: string, offset: number): { visible: string; offset: number; leave: boolean } {
  const parts = sceneParts(visible);
  const zone = sceneZone(parts, offset);
  if (zone === "time") return { visible, offset, leave: true };
  if (zone === "intro") {
    const gap = visible.slice(parts.introEnd, parts.locationStart);
    const next = parts.intro + (gap.startsWith(" ") ? gap : " ") + visible.slice(parts.locationStart);
    const again = sceneParts(next);
    const cursor = again.location ? again.locationEnd : again.locationStart;
    return { visible: next, offset: cursor, leave: false };
  }
  const hasTime = Boolean(parts.time) || /\s+-\s+/.test(visible.slice(parts.introEnd));
  const next = hasTime ? visible : `${visible.slice(0, parts.locationEnd)} - ${parts.time}`;
  const again = sceneParts(next);
  const cursor = again.time ? again.timeStart + again.time.length : again.timeStart;
  return { visible: next, offset: cursor, leave: false };
}

export function cueName(visible: string): string {
  return visible.replace(/\([^)]*\)/g, "").trim();
}

export function characterNames(doc: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const element of parseScript(doc)) {
    if (element.type !== "character") continue;
    const name = cueName(element.text);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function locations(doc: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const element of parseScript(doc)) {
    if (element.type !== "scene") continue;
    const location = sceneParts(element.text).location.trim();
    if (!location || seen.has(location)) continue;
    seen.add(location);
    found.push(location);
  }
  return found;
}

/** The other person in the current scene, once two characters have spoken. */
export function otherSpeaker(doc: string, before: number): string | null {
  const names: string[] = [];
  for (const element of parseScript(doc)) {
    if (element.from >= before) break;
    if (element.type === "scene" || element.type === "act") names.length = 0;
    if (element.type !== "character") continue;
    const name = cueName(element.text);
    if (name) names.push(name);
  }
  if (names.length < 2) return null;
  const last = names[names.length - 1];
  for (let i = names.length - 2; i >= 0; i -= 1) {
    if (names[i] !== last) return names[i];
  }
  return null;
}

export function completions(doc: string, cursor: number): CompletionList | null {
  const element = elementAt(doc, cursor);
  if (!element) return null;
  const at = cursor - (element.from + element.marker);
  if (at < 0) return null;
  if (element.type === "character") return characterList(doc, element, at);
  if (element.type === "scene") return sceneList(doc, element, at);
  if (element.type === "transition") {
    return matching(TRANSITIONS, element.text.slice(0, at), element.from + element.marker, element.to);
  }
  return null;
}

function characterList(doc: string, element: ScriptElement, at: number): CompletionList | null {
  const start = element.from + element.marker;
  const paren = element.text.indexOf("(");
  if (paren >= 0 && at >= paren) {
    const typed = element.text.slice(paren, at);
    const end = endOf(element.text, paren, ")");
    return matching(EXTENSIONS, typed, start + paren, start + end);
  }
  const baseEnd = paren >= 0 ? paren : element.text.length;
  const typed = element.text.slice(0, Math.min(at, baseEnd)).trim().toUpperCase();
  const other = otherSpeaker(doc, element.from);
  const ordered = other
    ? [other, ...characterNames(doc).filter((name) => name !== other)]
    : characterNames(doc);
  return matching(ordered, typed, start, start + baseEnd);
}

function sceneList(doc: string, element: ScriptElement, at: number): CompletionList | null {
  const parts = sceneParts(element.text);
  const start = element.from + element.marker;
  const zone = sceneZone(parts, at);
  if (zone === "intro") return matching(INTROS, element.text.slice(0, at), start, start + parts.introEnd);
  if (zone === "time") {
    return matching(TIMES, element.text.slice(parts.timeStart, at), start + parts.timeStart, start + element.text.length);
  }
  const typed = element.text.slice(parts.locationStart, Math.min(at, parts.locationEnd));
  const options = locations(doc).filter((location) => location.startsWith(typed.toUpperCase()) && location !== typed.toUpperCase());
  if (options.length === 0) return null;
  return { from: start + parts.locationStart, to: start + parts.locationEnd, options };
}

function matching(pool: readonly string[], typed: string, from: number, to: number): CompletionList | null {
  const upper = typed.toUpperCase();
  const options = pool.filter((item) => item.startsWith(upper) && item !== upper);
  if (options.length === 0) return null;
  return { from, to: Math.max(from, to), options };
}

function endOf(text: string, from: number, closer: string): number {
  const end = text.indexOf(closer, from);
  return end < 0 ? text.length : end + closer.length;
}
