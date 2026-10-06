import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("native capabilities", () => {
  it("allows the forced close used after a successful save", async () => {
    const path = new URL("../../src-tauri/capabilities/default.json", import.meta.url);
    const capability = JSON.parse(await readFile(path, "utf8")) as { permissions: string[] };
    expect(capability.permissions).toContain("core:window:allow-destroy");
  });
});
