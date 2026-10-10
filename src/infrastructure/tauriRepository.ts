import { invoke } from "@tauri-apps/api/core";
import type { OpenedScript, ScriptRepository } from "../application/repository";

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

  readExternal(): Promise<{ changed: boolean; text: string | null }> {
    return invoke("read_external_script");
  }

  acknowledgeExternal(text: string | null): Promise<void> {
    return invoke("acknowledge_script", { text });
  }

  ensureCompanion(): Promise<void> {
    return invoke("ensure_companion");
  }

  stopCompanion(): Promise<void> {
    return invoke("stop_companion");
  }
}
