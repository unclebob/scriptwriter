import { describe, expect, it } from "vitest";
import { renderPdf } from "./pdf";

describe("pdf", () => {
  it("writes a title page and a script page in Courier", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "Written by",
      author: "A. Writer",
      contact: "A\n\nwriter@example.com",
      draft: "October 2026",
      body: "INT. KITCHEN - DAY\n\nBob waits.\n\n@BOB\nTea?",
    });
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Courier");
    expect(pdf).toContain("/Kids [4 0 R 6 0 R] /Count 2");
    expect(pdf).toContain("/Contents 5 0 R");
    expect(pdf).toContain("/Contents 7 0 R");
    expect(pdf).toContain("1 0 0 1 270.00 561.60 Tm\n(THE KETTLE) Tj");
    expect(pdf).toContain("270.00 559.60 m 342.00 559.60 l S");
    expect(pdf).toContain("1 0 0 1 270.00 525.60 Tm\n(Written by) Tj");
    expect(pdf).toContain("1 0 0 1 273.60 501.60 Tm\n(A. Writer) Tj");
    expect(pdf).toContain("1 0 0 1 262.80 477.60 Tm\n(October 2026) Tj");
    expect(pdf).toContain("1 0 0 1 108.00 84.00 Tm\n(A) Tj");
    expect(pdf).toContain("1 0 0 1 108.00 72.00 Tm\n(writer@example.com) Tj");
    expect(pdf).toContain("1 0 0 1 532.80 756.00 Tm\n(1) Tj");
    expect(pdf).toContain("1 0 0 1 108.00 708.00 Tm\n(INT. KITCHEN - DAY) Tj");
    expect(pdf).toContain("1 0 0 1 90.00 708.00 Tm\n(1) Tj");
    expect(pdf).toContain("1 0 0 1 550.80 708.00 Tm\n(1) Tj");
    expect(pdf).toContain("1 0 0 1 266.40 660.00 Tm\n(BOB) Tj");
    expect(pdf).toContain("1 0 0 1 180.00 648.00 Tm\n(Tea?) Tj");
    expect(pdf.match(/\/Type \/Page /g)?.length).toBe(2);
    expect(pdf).toContain("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>");
    expect(pdf).toContain("4 0 obj\n<< /Type /Page ");
    const xrefAt = pdf.indexOf("xref\n");
    const told = Number(pdf.match(/startxref\n(\d+)\n/)?.[1]);
    expect(told).toBe(xrefAt);
    const rows = pdf.slice(xrefAt).split("\n");
    expect(rows[1]).toBe("0 8");
    expect(rows[3]).toBe(`${String(pdf.indexOf("1 0 obj\n")).padStart(10, "0")} 00000 n `);
    expect(rows[10]).toBe("trailer << /Size 8 /Root 1 0 R >>");
  });

  it("numbers scenes and centers an act", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "",
      author: "",
      contact: "",
      draft: "",
      body: "ACT ONE\n\n\nINT. KITCHEN - DAY\n\nBob waits.\n\n\nINT. PORCH - NIGHT\n\nAlice waits.",
    });
    expect(pdf).toContain("ACT ONE");
    expect(pdf).toContain("1 0 0 1 298.80");
    expect(pdf).toContain("(2)");
  });

  it("places a parenthetical and a transition on their margins", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "",
      author: "",
      contact: "",
      draft: "",
      body: "INT. KITCHEN - DAY\n\n@BOB\n(quietly)\nHi.\n\nCUT TO:",
    });
    expect(pdf).toContain("1 0 0 1 223.20");
    expect(pdf).toContain("1 0 0 1 489.60");
    expect(pdf).toContain("(\\(quietly\\))");
    expect(pdf).toContain("(CUT TO:)");
  });

  it("numbers a forced scene heading from its visible text", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "",
      author: "",
      contact: "",
      draft: "",
      body: "INT. KITCHEN - DAY\n\nBob.\n\n.LATER",
    });
    expect(pdf).toContain("1 0 0 1 108.00 660.00 Tm\n(LATER) Tj");
    expect(pdf).toContain("1 0 0 1 90.00 660.00 Tm\n(2) Tj");
    expect(pdf).toContain("1 0 0 1 550.80 660.00 Tm\n(2) Tj");
  });

  it("escapes a high byte and prints a tilde as itself", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "",
      author: "",
      contact: "",
      draft: "",
      body: "Bob~. \u00ff",
    });
    expect(pdf).toContain("(Bob~. \\377)");
  });

  it("skips an empty action instead of drawing it", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "",
      author: "",
      contact: "",
      draft: "",
      body: "!\n\nBob.",
    });
    expect(pdf).toContain("(Bob.) Tj");
    expect(pdf).not.toContain("() Tj");
  });

  it("centers (MORE) under the speech", () => {
    const speech = "word ".repeat(400).trim();
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "",
      author: "",
      contact: "",
      draft: "",
      body: `@BOB\n${speech}`,
    });
    expect(pdf).toContain("1 0 0 1 302.40");
    expect(pdf).toContain("(\\(MORE\\))");
  });
});
