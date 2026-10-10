import type { DocumentSnapshot, PositionedElement } from "../domain/document";
import { cueName } from "../domain/elements";
import { wrapText } from "./layout";

export type SceneRow = {
  number: number;
  page: number;
  act: string;
  location: string;
  actors: string[];
  text: string;
  from: number;
};

export type OutlineRow = {
  kind: "act" | "scene";
  text: string;
  from: number;
  number: number | null;
};

/** Scenes in script order. The number is derived, never stored. */
export function sceneRows(document: DocumentSnapshot, pageStarts: readonly number[]): SceneRow[] {
  const rows: SceneRow[] = [];
  let act = "";
  let number = 0;
  for (let index = 0; index < document.elements.length; index += 1) {
    const element = document.elements[index];
    if (element.type === "act") {
      act = element.text.trim();
      continue;
    }
    if (element.type !== "scene") continue;
    number += 1;
    rows.push({
      number,
      page: pageFor(element.from, pageStarts),
      act,
      location: element.text.trim(),
      actors: actorsAfter(document.elements, index),
      text: element.text,
      from: element.from,
    });
  }
  return rows;
}

function pageFor(source: number, pageStarts: readonly number[]): number {
  let page = 1;
  for (const start of pageStarts) {
    if (start > source) break;
    page += 1;
  }
  return page;
}

function actorsAfter(elements: readonly PositionedElement[], index: number): string[] {
  const actors: string[] = [];
  const seen = new Set<string>();
  for (let next = index + 1; next < elements.length; next += 1) {
    const element = elements[next];
    if (element.type === "scene" || element.type === "act") break;
    if (element.type !== "character") continue;
    const name = cueName(element.text);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    actors.push(name);
  }
  return actors;
}

/** Acts and scene headings in script order, for the list beside the page. */
export function outline(document: DocumentSnapshot): OutlineRow[] {
  const rows: OutlineRow[] = [];
  let number = 0;
  for (const element of document.elements) {
    if (element.type === "act") {
      rows.push({ kind: "act", text: element.text.trim() || "Act", from: element.from, number: null });
      continue;
    }
    if (element.type !== "scene") continue;
    number += 1;
    rows.push({ kind: "scene", text: element.text.trim() || "Scene", from: element.from, number });
  }
  return rows;
}

/** Mono characters that fit the 390-point shooting-schedule page. */
const LINE_WIDTH = 49;
const GUTTER = "      ";
const CONTENT_WIDTH = LINE_WIDTH - GUTTER.length;

/** Lines for a shooting schedule, sorted by location. Scene numbers stay the script's numbers. */
export function scheduleLines(
  title: string,
  rows: readonly SceneRow[],
  elements: readonly PositionedElement[],
): string[] {
  const body = [...rows].sort(byLocation).flatMap((row, index) => sceneBlock(row, index, elements));
  return [...scheduleHeading(title), ...body];
}

function scheduleHeading(title: string): string[] {
  const name = title.trim();
  const shown = name === "" ? "Untitled" : name;
  return [...wrapText(shown, LINE_WIDTH), "SHOOTING SCHEDULE", ""];
}

function sceneBlock(row: SceneRow, index: number, elements: readonly PositionedElement[]): string[] {
  const lines = sceneBody(row, elements);
  if (index === 0) return lines;
  return ["", ...lines];
}

function sceneBody(row: SceneRow, elements: readonly PositionedElement[]): string[] {
  const lines = [...locationLines(row), ...detailLines(row), ...actorLines(row.actors)];
  const body = elementLines(sceneElements(elements, row.from));
  if (body.length === 0) return lines;
  return [...lines, "", ...body];
}

function sceneElements(elements: readonly PositionedElement[], from: number): readonly PositionedElement[] {
  const start = elements.findIndex((element) => headingAt(element, from));
  if (start < 0) return [];
  return elements.slice(start + 1, nextBoundary(elements, start));
}

function headingAt(element: PositionedElement, from: number): boolean {
  return element.type === "scene" && element.from === from;
}

function nextBoundary(elements: readonly PositionedElement[], start: number): number {
  const next = elements.findIndex((element, index) => boundaryAfter(element, index, start));
  if (next < 0) return elements.length;
  return next;
}

function boundaryAfter(element: PositionedElement, index: number, start: number): boolean {
  if (index <= start) return false;
  return sceneOrAct(element.type);
}

function sceneOrAct(type: string): boolean {
  return type === "scene" || type === "act";
}

function elementLines(elements: readonly PositionedElement[]): string[] {
  return elements.flatMap(elementText);
}

function elementText(element: PositionedElement): string[] {
  if (element.text.trim() === "") return [];
  return wrapText(element.text, CONTENT_WIDTH).map(gutterLine);
}

function gutterLine(line: string): string {
  return `${GUTTER}${line}`;
}

function locationLines(row: SceneRow): string[] {
  return wrapText(row.location, CONTENT_WIDTH).map((line, index) => locationLine(row.number, line, index));
}

function locationLine(number: number, line: string, index: number): string {
  if (index === 0) return `${String(number).padStart(4)}  ${line}`;
  return gutterLine(line);
}

function detailLines(row: SceneRow): string[] {
  return wrapText(pageAndAct(row), CONTENT_WIDTH).map(gutterLine);
}

function pageAndAct(row: SceneRow): string {
  if (row.act === "") return `page ${row.page}`;
  return `page ${row.page}  ${row.act}`;
}

function actorLines(actors: readonly string[]): string[] {
  if (actors.length === 0) return [];
  return wrapText(actors.join(", "), CONTENT_WIDTH).map(gutterLine);
}

/** CSV sorted by the complete, opaque scene heading, then by scene number. */
export function scenesCsv(rows: readonly SceneRow[]): string {
  const lines = ["Location,Scene,Page,Act,Actors"];
  for (const row of [...rows].sort(byLocation)) {
    lines.push(
      [
        safeCsvField(row.location),
        String(row.number),
        String(row.page),
        safeCsvField(row.act),
        safeCsvField(row.actors.join(", ")),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function byLocation(a: SceneRow, b: SceneRow): number {
  const empty = emptyLocationOrder(a, b);
  if (empty !== 0) return empty;
  return locationOrder(a, b);
}

function emptyLocationOrder(a: SceneRow, b: SceneRow): number {
  if (emptyFirst(a.location, b.location)) return 1;
  if (emptyFirst(b.location, a.location)) return -1;
  return 0;
}

function emptyFirst(location: string, other: string): boolean {
  return location === "" && other !== "";
}

function locationOrder(a: SceneRow, b: SceneRow): number {
  const compared = a.location.localeCompare(b.location, undefined, { sensitivity: "base" });
  return compared !== 0 ? compared : a.number - b.number;
}

export function safeCsvField(value: string): string {
  const neutralized = /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutralized)) return `"${neutralized.replace(/"/g, '""')}"`;
  return neutralized;
}
