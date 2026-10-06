import type { DocumentSnapshot, PositionedElement } from "../domain/document";
import { cueName } from "./completion";

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
  if (a.location === "" && b.location !== "") return 1;
  if (b.location === "" && a.location !== "") return -1;
  const compared = a.location.localeCompare(b.location, undefined, { sensitivity: "base" });
  return compared !== 0 ? compared : a.number - b.number;
}

export function safeCsvField(value: string): string {
  const neutralized = /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutralized)) return `"${neutralized.replace(/"/g, '""')}"`;
  return neutralized;
}
