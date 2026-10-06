import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import { renderPdf } from "./pdf";

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

  it("reports an unsupported glyph instead of silently replacing it", async () => {
    const document = elementsDocument(normalizeElements([{ type: "action", text: "漢" }]));
    await expect(renderPdf(header, document)).rejects.toThrow(/does not support.*U\+/);
  });
});
