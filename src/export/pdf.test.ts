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

  it("reports an unsupported glyph instead of silently replacing it", async () => {
    const document = elementsDocument(normalizeElements([{ type: "action", text: "漢" }]));
    await expect(renderPdf(header, document)).rejects.toThrow(/does not support.*U\+/);
  });
});
