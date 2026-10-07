import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import { rgb } from "pdf-lib";
import {
  centeredX,
  contactLines,
  contactPosition,
  creditStart,
  headerLines,
  extendRun,
  ink,
  lineY,
  nextCreditY,
  pageNumberPosition,
  renderPdf,
  sceneNumberPosition,
  scriptPageNumber,
  titleTop,
  titleUnderline,
} from "./pdf";

const header = {
  title: "The Kettle",
  credit: "Written by",
  author: "A. Writer",
  contact: "writer@example.com",
  draft: "October 2026",
};

type PlacedText = { str: string; x: number; y: number; width: number };

async function placedText(bytes: Uint8Array): Promise<PlacedText[]> {
  const pdf = await getDocument({ data: bytes }).promise;
  const items: PlacedText[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !("transform" in item) || !("width" in item)) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
    }
  }
  return items;
}

function at(items: readonly PlacedText[], text: string): PlacedText {
  const found = items.find((item) => item.str === text);
  if (!found) throw new Error(`missing PDF text ${text}`);
  return found;
}

function lineEnd(items: readonly PlacedText[], item: PlacedText): number {
  const row = items.filter((other) => Math.abs(other.y - item.y) < 0.5);
  return Math.max(...row.map((other) => other.x + other.width));
}

function spanCenter(first: PlacedText, last: PlacedText): number {
  return (first.x + last.x + last.width) / 2;
}

async function extracted(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
  }
  return { pages: pdf.numPages, text: pages.join("\n") };
}

describe("PDF export", () => {
  it("produces a parseable title page and screenplay page", async () => {
    const document = elementsDocument(
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Bob waits." },
        { type: "character", text: "BOB" },
        { type: "dialogue", text: "Tea?" },
      ]),
    );
    const pdf = await extracted(await renderPdf(header, document));
    expect(pdf.pages).toBe(2);
    expect(pdf.text).toContain("THE KETTLE");
    expect(pdf.text).toContain("ROOM");
    expect(pdf.text).toContain("Tea?");
  });

  it("round-trips curly quotes, accents, Greek, and Cyrillic through a real PDF parser", async () => {
    const unicode = "It’s café — Καλημέρα — Привет";
    const document = elementsDocument(normalizeElements([{ type: "action", text: unicode }]));
    const pdf = await extracted(await renderPdf({ ...header, title: "L’été" }, document));
    expect(pdf.text).toContain("L’ÉTÉ");
    expect(pdf.text).toContain(unicode);
  });

  it("numbers an empty scene heading", async () => {
    const document = elementsDocument(
      normalizeElements([
        { type: "scene", text: "ROOM" },
        { type: "scene", text: "" },
      ]),
    );
    const pdf = await getDocument({ data: await renderPdf(header, document) }).promise;
    const page = await pdf.getPage(2);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => ("str" in item ? item.str : ""));
    expect(strings).toContain("ROOM");
    expect(strings).toContain("2");
  });

  it("places each element role on its screenplay margin", async () => {
    const speech = "word ".repeat(400).trim();
    const document = elementsDocument(
      normalizeElements([
        { type: "act", text: "ACT ONE" },
        { type: "scene", text: "ROOM" },
        { type: "action", text: "Bob waits." },
        { type: "shot", text: "ANGLE ON THE KETTLE" },
        { type: "character", text: "BOB" },
        { type: "parenthetical", text: "(quietly)" },
        { type: "dialogue", text: "Tea?" },
        { type: "transition", text: "CUT TO:" },
        { type: "character", text: "ANN" },
        { type: "dialogue", text: speech },
      ]),
    );
    const items = await placedText(await renderPdf(header, document));
    const left = 1.5 * 72;
    const columnCenter = left + 3 * 72;
    expect(at(items, "Bob").x).toBeCloseTo(left, 0);
    expect(at(items, "ANGLE").x).toBeCloseTo(left, 0);
    expect(at(items, "Tea?").x).toBeCloseTo(2.5 * 72, 0);
    expect(at(items, "(quietly)").x).toBeCloseTo(3.1 * 72, 0);
    expect(at(items, "BOB").x).toBeCloseTo(3.7 * 72, 0);
    expect(lineEnd(items, at(items, "CUT"))).toBeCloseTo(7.5 * 72, 0);
    expect(spanCenter(at(items, "ACT"), at(items, "ONE"))).toBeCloseTo(columnCenter, 0);
    const more = at(items, "(MORE)");
    expect(more.x + more.width / 2).toBeCloseTo(columnCenter, 0);
  });

  it("centers the title and subsets the font", async () => {
    const document = elementsDocument(normalizeElements([{ type: "action", text: "Hi." }]));
    const bytes = await renderPdf(header, document);
    expect(bytes.length).toBeLessThan(200_000);
    expect(Buffer.from(bytes).includes(Buffer.from("ObjStm"))).toBe(false);
    const items = await placedText(bytes.slice());
    const title = items.find((item) => item.str.includes("KETTLE"));
    if (!title) throw new Error(items.map((item) => item.str).join("|"));
    const row = items.filter((item) => Math.abs(item.y - title.y) < 0.5);
    const left = Math.min(...row.map((item) => item.x));
    const right = Math.max(...row.map((item) => item.x + item.width));
    expect((left + right) / 2).toBeCloseTo(612 / 2, 1);
  });

  it("underlines the title two points below it in black", () => {
    expect(titleUnderline(10, 20, 30)).toEqual({ startX: 10, endX: 40, y: 18, thickness: 1 });
    expect(ink()).toEqual(rgb(0, 0, 0));
  });

  it("places the title, credits, page number, and contact from the screenplay margins", () => {
    expect(titleTop()).toBeCloseTo(792 - 3.2 * 72, 5);
    expect(centeredX(100)).toBe(256);
    expect(creditStart(500)).toBe(464);
    expect(nextCreditY(464)).toBe(440);
    expect(headerLines({ credit: "Written by", author: "", draft: "October" })).toEqual(["Written by", "October"]);
    expect(contactLines("A\n\nBeta")).toEqual(["A", "Beta"]);
    expect(contactPosition(2, 0)).toEqual({ x: 1.5 * 72, y: 84 });
    expect(contactPosition(2, 1)).toEqual({ x: 1.5 * 72, y: 72 });
    expect(scriptPageNumber(0)).toBe(1);
    expect(scriptPageNumber(1)).toBe(2);
    expect(pageNumberPosition(10)).toEqual({ x: 7.5 * 72 - 10, y: 756 });
    expect(sceneNumberPosition(10, "left")).toBeCloseTo(1.35 * 72 - 10, 5);
    expect(sceneNumberPosition(10, "right")).toBeCloseTo(7.65 * 72, 5);
    expect(lineY(0)).toBe(708);
    expect(lineY(2)).toBe(684);
    const runs: { key: string; text: string }[] = [];
    extendRun(runs, "mono", "T");
    extendRun(runs, "mono", "e");
    extendRun(runs, "other", "a");
    expect(runs).toEqual([
      { key: "mono", text: "Te" },
      { key: "other", text: "a" },
    ]);
  });

  it("reports an unsupported glyph instead of silently replacing it", async () => {
    const document = elementsDocument(normalizeElements([{ type: "action", text: "漢" }]));
    await expect(renderPdf(header, document)).rejects.toThrow("U+6F22");
  });
});
