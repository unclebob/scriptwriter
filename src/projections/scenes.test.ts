import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements, type ScriptElement } from "../domain/document";
import { pageStarts, paginate } from "./layout";
import { outline, safeCsvField, sceneRows, scenesCsv, scheduleLines, type SceneRow } from "./scenes";

function document(elements: readonly Omit<ScriptElement, "blanksBefore">[]) {
  return elementsDocument(normalizeElements(elements));
}

function scenes(script: ReturnType<typeof document>) {
  return sceneRows(script, pageStarts(paginate(script)));
}

const script = document([
  { type: "act", text: "ACT ONE" },
  { type: "scene", text: "INT. KITCHEN - DAY" },
  { type: "character", text: "BOB" },
  { type: "dialogue", text: "Tea?" },
  { type: "character", text: "ALICE (V.O.)" },
  { type: "dialogue", text: "Please." },
  { type: "scene", text: "=1+1" },
  { type: "character", text: "@MAL" },
]);

describe("scene projection", () => {
  it("numbers explicit scenes and treats their entire text as the location", () => {
    expect(scenes(script).map((row) => [row.number, row.page, row.act, row.location, row.actors.join("|")])).toEqual([
      [1, 1, "ACT ONE", "INT. KITCHEN - DAY", "BOB|ALICE"],
      [2, 1, "ACT ONE", "=1+1", "@MAL"],
    ]);
  });

  it("uses the shared pagination projection for each scene page", () => {
    const longScript = document([
      { type: "scene", text: "FIRST" },
      ...Array.from({ length: 30 }, (_, index) => ({ type: "action" as const, text: `Line ${index + 1}.` })),
      { type: "scene", text: "SECOND" },
    ]);
    expect(scenes(longScript).map((row) => [row.number, row.page])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("lists acts and scenes in document order", () => {
    expect(outline(script).map((row) => [row.kind, row.number, row.text])).toEqual([
      ["act", null, "ACT ONE"],
      ["scene", 1, "INT. KITCHEN - DAY"],
      ["scene", 2, "=1+1"],
    ]);
  });

  it("neutralizes formulas after whitespace or control characters and still quotes CSV", () => {
    for (const value of ["=SUM(A1)", "+1", "-2", "@cmd", "  =1", "\t@x"]) {
      expect(safeCsvField(value).startsWith("'")).toBe(true);
    }
    expect(safeCsvField('a,"b"\nc')).toBe('"a,""b""\nc"');
    const csv = scenesCsv(scenes(script));
    expect(csv.split("\n")[0]).toBe("Location,Scene,Page,Act,Actors");
    expect(csv).toContain("INT. KITCHEN - DAY,1,1,ACT ONE");
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@MAL");
    const untitled = scenes(document([
      { type: "scene", text: "" },
      { type: "scene", text: "ROOM" },
      { type: "scene", text: "room" },
    ]));
    const locations = scenesCsv(untitled).trim().split("\n").slice(1).map((line) => line.split(",")[0]);
    expect(locations).toEqual(["ROOM", "room", ""]);
  });

  it("counts a scene that begins exactly where a page begins", () => {
    const exact = document([{ type: "scene", text: "ROOM" }]);
    expect(sceneRows(exact, [exact.elements[0].from])[0].page).toBe(2);
  });

  it("lists each actor once and stops before the next scene", () => {
    const room = document([
      { type: "scene", text: "ROOM" },
      { type: "character", text: "BOB" },
      { type: "character", text: "BOB (V.O.)" },
      { type: "character", text: "()" },
      { type: "character", text: "ANN" },
      { type: "scene", text: "HALL" },
      { type: "character", text: "MAL" },
    ]);
    expect(sceneRows(room, [])[0].actors).toEqual(["BOB", "ANN"]);
  });

  it("lists a shooting schedule by location, keeps the script scene numbers, and includes every element", () => {
    const script = document([
      { type: "action", text: "COLD OPEN" },
      { type: "act", text: "ACT ONE" },
      { type: "scene", text: "OFFICE" },
      { type: "action", text: "Ann waits." },
      { type: "character", text: "ANN" },
      { type: "dialogue", text: "Coffee?" },
      { type: "action", text: "" },
      { type: "scene", text: "KITCHEN" },
      { type: "character", text: "BOB (V.O.)" },
      { type: "parenthetical", text: "(quietly)" },
      { type: "dialogue", text: "Tea?" },
      { type: "shot", text: "THE KETTLE" },
      { type: "transition", text: "CUT TO:" },
      { type: "act", text: "ACT TWO" },
      { type: "character", text: "MAL" },
      { type: "scene", text: "kitchen" },
      { type: "action", text: "Later." },
    ]);
    const lines = scheduleLines("The Kettle", scenes(script), script.elements);
    expect(lines).toEqual([
      "The Kettle",
      "SHOOTING SCHEDULE",
      "",
      "   2  KITCHEN",
      "      page 2  ACT ONE",
      "      BOB",
      "",
      "      BOB (V.O.)",
      "      (quietly)",
      "      Tea?",
      "      THE KETTLE",
      "      CUT TO:",
      "",
      "   3  kitchen",
      "      page 3  ACT TWO",
      "",
      "      Later.",
      "",
      "   1  OFFICE",
      "      page 2  ACT ONE",
      "      ANN",
      "",
      "      Ann waits.",
      "      ANN",
      "      Coffee?",
    ]);
    expect(lines.join("\n")).not.toContain("COLD OPEN");
    expect(lines.join("\n")).not.toContain("MAL");
    expect(scheduleLines("  ", [], [])[0]).toBe("Untitled");
  });

  it("wraps the shooting schedule to the width of an iPhone screen", () => {
    const wide = "A".repeat(60);
    const wrapped = scheduleLines("T", [{
      number: 7, page: 2, act: "", location: wide, actors: [], text: wide, from: 0,
    }], []);
    expect(wrapped).toContain(`   7  ${"A".repeat(43)}`);
    expect(wrapped).toContain(`      ${"A".repeat(17)}`);
    expect(wrapped).toContain("      page 2");
    const titled = scheduleLines("T".repeat(60), [], []);
    expect(titled[0]).toBe("T".repeat(49));
    expect(titled[1]).toBe("T".repeat(11));
    expect(titled[2]).toBe("SHOOTING SCHEDULE");
    for (const line of [...wrapped, ...titled]) expect(line.length).toBeLessThanOrEqual(49);
  });

  it("sorts locations alphabetically, empty ones last, and equal locations by number", () => {
    const row = (number: number, location: string): SceneRow => ({
      number, page: 1, act: "", location, actors: [], text: location, from: number,
    });
    const locations = (rows: SceneRow[]) =>
      scenesCsv(rows).trim().split("\n").slice(1).map((line) => line.split(",").slice(0, 2).join(","));
    expect(locations([row(1, "Z"), row(2, "A")])).toEqual(["A,2", "Z,1"]);
    expect(locations([row(2, "A"), row(1, "Z")])).toEqual(["A,2", "Z,1"]);
    expect(locations([row(2, "ROOM"), row(1, "ROOM")])).toEqual(["ROOM,1", "ROOM,2"]);
    expect(locations([row(1, "B"), row(2, "")])).toEqual(["B,1", ",2"]);
  });
});
