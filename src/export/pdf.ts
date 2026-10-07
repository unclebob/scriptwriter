import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";
import monoFont from "dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?inline";
import type { DocumentSnapshot } from "../domain/document";
import type { Script } from "../domain/script";
import { derive, type DerivedDocument } from "../projections/derived";
import type { Placed } from "../projections/layout";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEADING = 12;
const LEFT = 1.5 * 72;
const RIGHT = 7.5 * 72;
const FONT_SIZE = 12;

type Header = Pick<Script, "title" | "credit" | "author" | "contact" | "draft">;

export function lineY(index: number): number {
  return PAGE_HEIGHT - 72 - LEADING - index * LEADING;
}

export function scriptPageNumber(index: number): number {
  return index + 1;
}

export function pageNumberPosition(labelWidth: number): { x: number; y: number } {
  return { x: RIGHT - labelWidth, y: PAGE_HEIGHT - 36 };
}

export function sceneNumberPosition(labelWidth: number, edge: "left" | "right"): number {
  if (edge === "right") return 7.65 * 72;
  return 1.35 * 72 - labelWidth;
}

export function centeredX(width: number): number {
  return (PAGE_WIDTH - width) / 2;
}

export function titleTop(): number {
  return PAGE_HEIGHT - 3.2 * 72;
}

export function creditStart(top: number): number {
  return top - 36;
}

export function nextCreditY(y: number): number {
  return y - LEADING * 2;
}

export function headerLines(script: Pick<Header, "credit" | "author" | "draft">): string[] {
  return [script.credit, script.author, script.draft].filter((line) => line !== "");
}

export function contactLines(contact: string): string[] {
  return contact.split("\n").filter((line) => line.length > 0);
}

export function contactPosition(count: number, index: number): { x: number; y: number } {
  return { x: LEFT, y: 72 + (count - 1 - index) * LEADING };
}

type PdfFont = { pdf: PDFFont; characters: ReadonlySet<number> };

export async function renderPdf(
  script: Header,
  document: DocumentSnapshot,
  derived: DerivedDocument = derive(document),
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = dataBytes(monoFont);
  const parsed = fontkit.create(bytes);
  const subset = true;
  const fonts: PdfFont[] = [{
    pdf: await pdf.embedFont(bytes, { subset }),
    characters: new Set(parsed.characterSet),
  }];
  titlePage(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), script, fonts);
  const numbers = new Map(derived.scenes.map((scene) => [scene.from, scene.number]));
  derived.pages.forEach((lines, index) => {
    scriptPage(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), lines, scriptPageNumber(index), numbers, fonts);
  });
  return pdf.save({ useObjectStreams: false });
}

function titlePage(page: PDFPage, script: Header, fonts: readonly PdfFont[]) {
  const title = script.title.toUpperCase() || "UNTITLED";
  const titleWidth = textWidth(title, fonts);
  const titleX = centeredX(titleWidth);
  const titleY = titleTop();
  drawText(page, title, titleX, titleY, fonts);
  const underline = titleUnderline(titleX, titleY, titleWidth);
  page.drawLine({
    start: { x: underline.startX, y: underline.y },
    end: { x: underline.endX, y: underline.y },
    thickness: underline.thickness,
    color: ink(),
  });
  let y = creditStart(titleY);
  for (const line of headerLines(script)) {
    drawText(page, line, centeredX(textWidth(line, fonts)), y, fonts);
    y = nextCreditY(y);
  }
  const contact = contactLines(script.contact);
  contact.forEach((line, index) => {
    const place = contactPosition(contact.length, index);
    drawText(page, line, place.x, place.y, fonts);
  });
}

function scriptPage(
  page: PDFPage,
  lines: readonly Placed[],
  number: number,
  scenes: ReadonlyMap<number, number>,
  fonts: readonly PdfFont[],
) {
  const label = String(number);
  const pageNumber = pageNumberPosition(textWidth(label, fonts));
  drawText(page, label, pageNumber.x, pageNumber.y, fonts);
  lines.forEach((line, index) => {
    if (line.role === "blank") return;
    const y = lineY(index);
    if (line.text !== "") drawText(page, line.text, xOf(line, fonts), y, fonts);
    const sceneNumber = line.source === undefined ? undefined : scenes.get(line.source);
    if (sceneNumber !== undefined) drawSceneNumber(page, sceneNumber, y, fonts);
  });
}

function drawSceneNumber(page: PDFPage, sceneNumber: number, y: number, fonts: readonly PdfFont[]) {
  const label = String(sceneNumber);
  const width = textWidth(label, fonts);
  drawText(page, label, sceneNumberPosition(width, "left"), y, fonts);
  drawText(page, label, sceneNumberPosition(width, "right"), y, fonts);
}

function xOf(line: Placed, fonts: readonly PdfFont[]): number {
  const width = textWidth(line.text, fonts);
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

function drawText(page: PDFPage, value: string, x: number, y: number, fonts: readonly PdfFont[]) {
  let at = x;
  for (const run of fontRuns(value, fonts)) {
    page.drawText(run.text, { x: at, y, font: run.font.pdf, size: FONT_SIZE, color: ink() });
    at += run.font.pdf.widthOfTextAtSize(run.text, FONT_SIZE);
  }
}

export function titleUnderline(titleX: number, titleY: number, titleWidth: number) {
  const y = titleY - 2;
  const endX = titleX + titleWidth;
  const thickness = 1;
  return { startX: titleX, endX, y, thickness };
}

export function ink() {
  const red = 0;
  const green = 0;
  const blue = 0;
  return rgb(red, green, blue);
}

function textWidth(value: string, fonts: readonly PdfFont[]): number {
  const widths = fontRuns(value, fonts).map((run) => run.font.pdf.widthOfTextAtSize(run.text, FONT_SIZE));
  const start = 0;
  return widths.reduce((total, width) => total + width, start);
}

function fontRuns(value: string, fonts: readonly PdfFont[]): { font: PdfFont; text: string }[] {
  const runs: { key: PdfFont; text: string }[] = [];
  for (const character of value) {
    const font = fonts.find((candidate) => supports(candidate, character));
    if (!font) {
      const point = character.codePointAt(0);
      if (point === undefined) throw new Error(`The PDF font does not support ${JSON.stringify(character)}.`);
      const hex = point.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`The PDF font does not support ${JSON.stringify(character)} (U+${hex}).`);
    }
    extendRun(runs, font, character);
  }
  return runs.map((run) => ({ font: run.key, text: run.text }));
}

export function extendRun<T>(runs: { key: T; text: string }[], key: T, character: string): void {
  const lastIndex = runs.length - 1;
  const last = runs[lastIndex];
  if (last !== undefined && last.key === key) last.text += character;
  else runs.push({ key, text: character });
}

function supports(font: PdfFont, value: string): boolean {
  const point = value.codePointAt(0);
  return point !== undefined && font.characters.has(point);
}

function dataBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
