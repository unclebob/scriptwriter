import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Fs } from "./internals/script";

export function nodeFs(): Fs {
  return {
    async readText(path) {
      return readFile(path, "utf8");
    },
    async writeText(path, text) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    },
  };
}
