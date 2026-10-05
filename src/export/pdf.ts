import { paginate, type Placed } from "../internals/layout";
import { sceneRows } from "../internals/scenes";
import type { Script } from "../internals/script";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEADING = 12;
const FIRST_BASELINE = PAGE_HEIGHT - 72 - LEADING;
const CHAR = 7.2;
const LEFT = 1.5 * 72;
const RIGHT = 7.5 * 72;

const WIN: Record<string, number> = {
  "\u20ac": 0x80,
  "\u201a": 0x82,
  "\u0192": 0x83,
  "\u201e": 0x84,
  "\u2026": 0x85,
  "\u2020": 0x86,
  "\u2021": 0x87,
  "\u02c6": 0x88,
  "\u2030": 0x89,
  "\u0160": 0x8a,
  "\u2039": 0x8b,
  "\u0152": 0x8c,
  "\u017d": 0x8e,
  "\u2018": 0x91,
  "\u2019": 0x92,
  "\u201c": 0x93,
  "\u201d": 0x94,
  "\u2022": 0x95,
  "\u2013": 0x96,
  "\u2014": 0x97,
  "\u02dc": 0x98,
  "\u2122": 0x99,
  "\u0161": 0x9a,
  "\u203a": 0x9b,
  "\u0153": 0x9c,
  "\u017e": 0x9e,
  "\u0178": 0x9f,
};

export function renderPdf(script: Pick<Script, "title" | "credit" | "author" | "contact" | "draft" | "body">): string {
  const numbers = new Map(sceneRows(script.body).map((scene) => [scene.from + scene.marker, scene.number]));
  const pages = [titlePage(script), ...paginate(script.body).map((page, index) => scriptPage(page, index + 1, numbers))];
  return pdfDocument(pages);
}

function titlePage(script: Pick<Script, "title" | "credit" | "author" | "contact" | "draft">): string {
  const commands: string[] = [];
  const title = script.title.toUpperCase() || "UNTITLED";
  const titleWidth = title.length * CHAR;
  const titleX = (PAGE_WIDTH - titleWidth) / 2;
  const titleY = PAGE_HEIGHT - 3.2 * 72;
  text(commands, title, titleX, titleY);
  commands.push(`${titleX.toFixed(2)} ${(titleY - 2).toFixed(2)} m ${(titleX + titleWidth).toFixed(2)} ${(titleY - 2).toFixed(2)} l S`);
  let y = titleY - 36;
  for (const line of [script.credit, script.author, script.draft]) {
    if (!line) continue;
    const width = line.length * CHAR;
    text(commands, line, (PAGE_WIDTH - width) / 2, y);
    y -= LEADING * 2;
  }
  const contact = script.contact.split("\n").filter((line) => line.length > 0);
  contact.forEach((line, index) => {
    text(commands, line, LEFT, 72 + (contact.length - 1 - index) * LEADING);
  });
  return commands.join("\n");
}

function scriptPage(lines: Placed[], number: number, scenes: Map<number, number>): string {
  const commands: string[] = [];
  const label = String(number);
  text(commands, label, RIGHT - label.length * CHAR, PAGE_HEIGHT - 36);
  lines.forEach((line, index) => {
    if (line.role === "blank" || line.text === "") return;
    const y = FIRST_BASELINE - index * LEADING;
    text(commands, line.text, xOf(line), y);
    const sceneNumber = line.source === undefined ? undefined : scenes.get(line.source);
    if (sceneNumber !== undefined) drawSceneNumber(commands, sceneNumber, y);
  });
  return commands.join("\n");
}

function drawSceneNumber(commands: string[], sceneNumber: number, y: number) {
  const label = String(sceneNumber);
  text(commands, label, 1.35 * 72 - label.length * CHAR, y);
  text(commands, label, 7.65 * 72, y);
}

function xOf(line: Placed): number {
  const width = line.text.length * CHAR;
  switch (line.role) {
    case "character":
      return 3.7 * 72;
    case "dialogue":
      return 2.5 * 72;
    case "parenthetical":
      return 3.1 * 72;
    case "transition":
      return RIGHT - width;
    case "act":
    case "more":
      return LEFT + (6 * 72 - width) / 2;
    default:
      return LEFT;
  }
}

function text(commands: string[], value: string, x: number, y: number) {
  commands.push("BT");
  commands.push(`/F1 12 Tf`);
  commands.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
  commands.push(`${literal(value)} Tj`);
  commands.push("ET");
}

function literal(value: string): string {
  let out = "(";
  for (const char of value) out += escapeByte(pdfByte(char));
  return `${out})`;
}

function pdfByte(char: string): number {
  const mapped = WIN[char] ?? char.codePointAt(0) ?? 0x3f;
  return mapped <= 255 ? mapped : 0x3f;
}

function escapeByte(byte: number): string {
  if (byte === 0x28 || byte === 0x29 || byte === 0x5c) return `\\${String.fromCharCode(byte)}`;
  if (byte < 32 || byte > 126) return `\\${byte.toString(8).padStart(3, "0")}`;
  return String.fromCharCode(byte);
}

function pdfDocument(contents: string[]): string {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const fontId = 3;
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  let next = 4;
  for (let i = 0; i < contents.length; i += 1) {
    pageIds.push(next);
    contentIds.push(next + 1);
    next += 2;
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  contents.forEach((stream, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}
