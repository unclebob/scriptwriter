import { parseScript } from "./fountain";
import { cueName, sceneParts } from "./smarttype";

export type SceneRow = {
  number: number;
  act: string;
  location: string;
  actors: string[];
  text: string;
  from: number;
  marker: number;
};

export type OutlineRow = {
  kind: "act" | "scene";
  text: string;
  from: number;
  number: number | null;
};

/** Scenes in script order. The number is counted. It is not stored. */
export function sceneRows(doc: string): SceneRow[] {
  const elements = parseScript(doc);
  const rows: SceneRow[] = [];
  let act = "";
  let number = 0;
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i];
    if (element.type === "act") {
      act = element.text.trim();
      continue;
    }
    if (element.type !== "scene") continue;
    number += 1;
    const actors: string[] = [];
    const seen = new Set<string>();
    for (let j = i + 1; j < elements.length; j += 1) {
      const next = elements[j];
      if (next.type === "scene" || next.type === "act") break;
      if (next.type !== "character") continue;
      const name = cueName(next.text);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      actors.push(name);
    }
    rows.push({
      number,
      act,
      location: locationOf(element.text),
      actors,
      text: element.text,
      from: element.from,
      marker: element.marker,
    });
  }
  return rows;
}

/** Acts and scene headings in script order, for the list beside the page. */
export function outline(doc: string): OutlineRow[] {
  const rows: OutlineRow[] = [];
  let number = 0;
  for (const element of parseScript(doc)) {
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

/** CSV sorted by location, then by scene number. */
export function scenesCsv(doc: string): string {
  const lines = ["Location,Scene,Act,Actors"];
  for (const row of [...sceneRows(doc)].sort(byLocation)) {
    lines.push([csvField(row.location), String(row.number), csvField(row.act), csvField(row.actors.join(", "))].join(","));
  }
  return `${lines.join("\n")}\n`;
}

function locationOf(text: string): string {
  const parts = sceneParts(text);
  return (parts.intro ? parts.location : text).trim();
}

function byLocation(a: SceneRow, b: SceneRow): number {
  if (a.location === "" && b.location !== "") return 1;
  if (b.location === "" && a.location !== "") return -1;
  const compared = a.location.localeCompare(b.location, undefined, { sensitivity: "base" });
  if (compared !== 0) return compared;
  return a.number - b.number;
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
