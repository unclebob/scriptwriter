export type OpenedScript = { root: string; text: string | null };

export interface ScriptRepository {
  loadStartup(): Promise<OpenedScript>;
  chooseScript(): Promise<OpenedScript | null>;
  saveScript(text: string): Promise<void>;
  exportFile(suggestedName: string, extension: "pdf" | "csv", bytes: Uint8Array): Promise<boolean>;
}
