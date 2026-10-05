import { describe, expect, it } from "vitest";
import { renderPdf } from "./pdf";

describe("pdf", () => {
  it("writes a title page and a script page in Courier", () => {
    const pdf = renderPdf({
      title: "The Kettle",
      credit: "Written by",
      author: "A. Writer",
      contact: "writer@example.com",
      draft: "October 2026",
      body: "INT. KITCHEN - DAY\n\nBob waits.\n\n@BOB\nTea?",
    });
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Courier");
    expect(pdf).toContain("THE KETTLE");
    expect(pdf).toContain("INT. KITCHEN - DAY");
    expect(pdf).toContain("(Tea?)");
    expect(pdf.match(/\/Type \/Page /g)?.length).toBe(2);
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
    expect(pdf).toContain("(2)");
  });
});
