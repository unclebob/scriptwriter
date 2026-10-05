import { describe, expect, it } from "vitest";
import { joinPath } from "./path";

describe("paths", () => {
  it("joins relative parts and lets an absolute part start over", () => {
    expect(joinPath("folder", "script.json")).toBe("folder/script.json");
    expect(joinPath("/tmp/script", "script.json")).toBe("/tmp/script/script.json");
    expect(joinPath("folder", "/tmp/script.json")).toBe("/tmp/script.json");
    expect(joinPath("folder/", "script.json")).toBe("folder/script.json");
  });
});
