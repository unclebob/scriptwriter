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
const FIRST_BASELINE = PAGE_HEIGHT - 72 - LEADING;
const LEFT = 1.5 * 72;
const RIGHT = 7.5 * 72;
const FONT_SIZE = 12;

type Header = Pick<Script, "title" | "credit" | "author" | "contact" | "draft">;
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
  const fonts: PdfFont[] = [{
    pdf: await pdf.embedFont(bytes, { subset: true }),
    characters: new Set(parsed.characterSet),
  }];
  titlePage(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), script, fonts);
  const numbers = new Map(derived.scenes.map((scene) => [scene.from, scene.number]));
  derived.pages.forEach((lines, index) => scriptPage(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), lines, index + 1, numbers, fonts));
  return pdf.save({ useObjectStreams: false });
}

function titlePage(page: PDFPage, script: Header, fonts: readonly PdfFont[]) {
  const title = script.title.toUpperCase() || "UNTITLED";
  const titleWidth = textWidth(title, fonts);
  const titleX = (PAGE_WIDTH - titleWidth) / 2;
  const titleY = PAGE_HEIGHT - 3.2 * 72;
  drawText(page, title, titleX, titleY, fonts);
  page.drawLine({
    start: { x: titleX, y: titleY - 2 },
    end: { x: titleX + titleWidth, y: titleY - 2 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  let y = titleY - 36;
  for (const line of [script.credit, script.author, script.draft]) {
    if (!line) continue;
    drawText(page, line, (PAGE_WIDTH - textWidth(line, fonts)) / 2, y, fonts);
    y -= LEADING * 2;
  }
  const contact = script.contact.split("\n").filter((line) => line.length > 0);
  contact.forEach((line, index) => {
    drawText(page, line, LEFT, 72 + (contact.length - 1 - index) * LEADING, fonts);
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
  drawText(page, label, RIGHT - textWidth(label, fonts), PAGE_HEIGHT - 36, fonts);
  lines.forEach((line, index) => {
    if (line.role === "blank") return;
    const y = FIRST_BASELINE - index * LEADING;
    if (line.text !== "") drawText(page, line.text, xOf(line, fonts), y, fonts);
    const sceneNumber = line.source === undefined ? undefined : scenes.get(line.source);
    if (sceneNumber !== undefined) drawSceneNumber(page, sceneNumber, y, fonts);
  });
}

function drawSceneNumber(page: PDFPage, sceneNumber: number, y: number, fonts: readonly PdfFont[]) {
  const label = String(sceneNumber);
  drawText(page, label, 1.35 * 72 - textWidth(label, fonts), y, fonts);
  drawText(page, label, 7.65 * 72, y, fonts);
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
    page.drawText(run.text, { x: at, y, font: run.font.pdf, size: FONT_SIZE, color: rgb(0, 0, 0) });
    at += run.font.pdf.widthOfTextAtSize(run.text, FONT_SIZE);
  }
}

function textWidth(value: string, fonts: readonly PdfFont[]): number {
  return fontRuns(value, fonts).reduce(
    (width, run) => width + run.font.pdf.widthOfTextAtSize(run.text, FONT_SIZE),
    0,
  );
}

function fontRuns(value: string, fonts: readonly PdfFont[]): { font: PdfFont; text: string }[] {
  const runs: { font: PdfFont; text: string }[] = [];
  for (const character of value) {
    const font = fonts.find((candidate) => supports(candidate, character));
    if (!font) {
      const point = character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0") ?? "UNKNOWN";
      throw new Error(`The PDF font does not support ${JSON.stringify(character)} (U+${point}).`);
    }
    const last = runs[runs.length - 1];
    if (last?.font === font) last.text += character;
    else runs.push({ font, text: character });
  }
  return runs;
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
