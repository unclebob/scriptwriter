import { invoke } from "@tauri-apps/api/core";
import type { OpenedScript, ScriptRepository } from "./repository";

export class TauriScriptRepository implements ScriptRepository {
  loadStartup(): Promise<OpenedScript> {
    return invoke("load_startup_script");
  }

  chooseScript(): Promise<OpenedScript | null> {
    return invoke("choose_script");
  }

  commitScript(): Promise<void> {
    return invoke("commit_script");
  }

  saveScript(text: string): Promise<void> {
    return invoke("save_active_script", { text });
  }

  exportFile(suggestedName: string, extension: "pdf" | "csv", bytes: Uint8Array): Promise<boolean> {
    return invoke("export_file", { suggestedName, extension, bytes: Array.from(bytes) });
  }
}
