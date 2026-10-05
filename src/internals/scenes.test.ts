import { describe, expect, it } from "vitest";
import { outline, sceneRows, scenesCsv } from "./scenes";

const script = `ACT ONE

INT. KITCHEN - DAY

@BOB
Tea?

@ALICE (V.O.)
Please.

@BOB
Thanks.


EXT. PORCH - NIGHT

@ALICE
Good night.

ACT TWO

INT. KITCHEN - NIGHT

@CAROL
It's late.

.LATER

@BOB (O.S.)
Still here.`;

describe("scenes", () => {
  it("numbers scenes, keeps the act, and lists each actor once", () => {
    expect(sceneRows(script).map((row) => [row.number, row.act, row.location, row.actors.join("|")])).toEqual([
      [1, "ACT ONE", "KITCHEN", "BOB|ALICE"],
      [2, "ACT ONE", "PORCH", "ALICE"],
      [3, "ACT TWO", "KITCHEN", "CAROL"],
      [4, "ACT TWO", "LATER", "BOB"],
    ]);
  });

  it("stops a scene's cast at the next act", () => {
    const doc = "INT. KITCHEN - DAY\n\n@BOB\nHi.\n\n\nACT TWO\n\n@ALICE\nHello.\n\n\nINT. PORCH - DAY\n";
    expect(sceneRows(doc).map((row) => [row.number, row.act, row.actors.join("|")])).toEqual([
      [1, "", "BOB"],
      [2, "ACT TWO", ""],
    ]);
  });

  it("sorts the csv by location and then by scene number", () => {
    expect(scenesCsv(script)).toBe(
      [
        "Location,Scene,Act,Actors",
        "KITCHEN,1,ACT ONE,\"BOB, ALICE\"",
        "KITCHEN,3,ACT TWO,CAROL",
        "LATER,4,ACT TWO,BOB",
        "PORCH,2,ACT ONE,ALICE",
        "",
      ].join("\n"),
    );
  });

  it("lists acts and numbered scenes in script order", () => {
    expect(outline(script).map((row) => [row.kind, row.number, row.text])).toEqual([
      ["act", null, "ACT ONE"],
      ["scene", 1, "INT. KITCHEN - DAY"],
      ["scene", 2, "EXT. PORCH - NIGHT"],
      ["act", null, "ACT TWO"],
      ["scene", 3, "INT. KITCHEN - NIGHT"],
      ["scene", 4, "LATER"],
    ]);
  });
});
