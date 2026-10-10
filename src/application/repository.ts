export type OpenedScript = { root: string; text: string | null };

export type ExternalScript = { changed: boolean; text: string | null };

export interface ScriptRepository {
  loadStartup(): Promise<OpenedScript>;
  chooseScript(): Promise<OpenedScript | null>;
  commitScript(): Promise<void>;
  saveScript(text: string): Promise<void>;
  exportFile(suggestedName: string, extension: "pdf" | "csv", bytes: Uint8Array): Promise<boolean>;
  readExternal(): Promise<ExternalScript>;
  acknowledgeExternal(text: string | null): Promise<void>;
  ensureCompanion(): Promise<void>;
  stopCompanion(): Promise<void>;
}
