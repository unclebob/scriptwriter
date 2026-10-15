import { invoke } from "@tauri-apps/api/core";
import type { ExternalScript, OpenedScript, SaveResult, ScriptRepository } from "../application/repository";

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

  async saveScript(text: string): Promise<SaveResult> {
    const outcome = await invoke<{ result: string }>("save_active_script", { text });
    return outcome.result === "conflict" ? "conflict" : "saved";
  }

  overwriteScript(text: string): Promise<void> {
    return invoke("overwrite_active_script", { text });
  }

  exportFile(suggestedName: string, extension: "pdf" | "csv", bytes: Uint8Array): Promise<boolean> {
    return invoke("export_file", { suggestedName, extension, bytes: Array.from(bytes) });
  }

  readExternal(): Promise<ExternalScript> {
    return invoke("read_external_script");
  }

  acknowledgeText(text: string | null): Promise<void> {
    return invoke("acknowledge_text", { text });
  }

  acknowledgeToken(token: string | null): Promise<void> {
    return invoke("acknowledge_token", { token });
  }

  writePlace(json: string): Promise<void> {
    return invoke("write_place", { json });
  }

  clearPlace(): Promise<void> {
    return invoke("clear_place");
  }

  ensureCompanion(): Promise<void> {
    return invoke("ensure_companion");
  }

  stopCompanion(): Promise<void> {
    return invoke("stop_companion");
  }
}
