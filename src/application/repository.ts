export type OpenedScript = { root: string; text: string | null };

export type ExternalScript = {
  text: string | null;
  diskChanged: boolean;
  token: string | null;
  tokenChanged: boolean;
};

export type SaveResult = "saved" | "conflict";

export type PullResult = "unchanged" | "reloaded" | "conflict" | "invalid";

export interface ScriptRepository {
  loadStartup(): Promise<OpenedScript>;
  chooseScript(): Promise<OpenedScript | null>;
  commitScript(): Promise<void>;
  saveScript(text: string): Promise<SaveResult>;
  overwriteScript(text: string): Promise<void>;
  exportFile(suggestedName: string, extension: "pdf" | "csv", bytes: Uint8Array): Promise<boolean>;
  readExternal(): Promise<ExternalScript>;
  acknowledgeText(text: string | null): Promise<void>;
  acknowledgeToken(token: string | null): Promise<void>;
  writePlace(json: string): Promise<void>;
  clearPlace(): Promise<void>;
  ensureCompanion(): Promise<void>;
  stopCompanion(): Promise<void>;
}
