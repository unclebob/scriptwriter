import { invoke } from "@tauri-apps/api/core";
import type { Fs } from "../internals/script";

export const tauriFs: Fs = {
  readText: (path) => invoke("read_text", { path }),
  writeText: (path, text) => invoke("write_text", { path, text }),
};

export function startupScriptPath(): Promise<string> {
  return invoke("startup_script_path");
}
