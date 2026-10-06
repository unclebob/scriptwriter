import { elementsDocument, storableElements, type DocumentSnapshot } from "../domain/document";
import { serializeScript, storedScript, type Script } from "../domain/script";
import type { ScriptRepository } from "../infrastructure/repository";
import { derive } from "../projections/derived";
import { scenesCsv } from "../projections/scenes";

export type SessionStatus = "empty" | "loading" | "ready" | "saving" | "error";

export type SessionState = {
  status: SessionStatus;
  script: Script | null;
  document: DocumentSnapshot | null;
  revision: number;
  savedRevision: number;
  error: string | null;
};

type Timer = ReturnType<typeof setTimeout>;
type HeaderField = "title" | "credit" | "author" | "contact" | "draft";

export class ScriptSession {
  private stateValue: SessionState = {
    status: "empty",
    script: null,
    document: null,
    revision: 0,
    savedRevision: 0,
    error: null,
  };
  private timer: Timer | null = null;
  private saving: Promise<void> | null = null;
  private generation = 0;
  private holdInput = false;
  private readonly listeners = new Set<(state: SessionState) => void>();

  constructor(
    private readonly repository: ScriptRepository,
    private readonly autosaveDelay = 400,
  ) {}

  get state(): SessionState {
    return this.stateValue;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.stateValue);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.setState({ status: "loading", error: null });
    try {
      this.load(await this.repository.loadStartup());
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async chooseScript(): Promise<boolean> {
    await this.flush();
    const selected = await this.repository.chooseScript();
    if (!selected) return false;
    this.holdInput = true;
    try {
      await this.flush();
      storedScript(selected.root, selected.text);
      await this.repository.commitScript();
      this.load(selected);
      return true;
    } finally {
      this.holdInput = false;
    }
  }

  setDocument(document: DocumentSnapshot): void {
    if (this.holdInput || !this.stateValue.script) return;
    this.setState({ document, revision: this.stateValue.revision + 1, status: "ready", error: null });
    this.schedule();
  }

  /** Share the editor's immutable snapshot immediately after loading, without creating an edit. */
  adoptLoadedDocument(document: DocumentSnapshot): void {
    if (!this.stateValue.script || this.stateValue.revision !== this.stateValue.savedRevision) return;
    this.setState({ document });
  }

  setHeader(field: HeaderField, value: string): void {
    if (this.holdInput) return;
    const script = this.stateValue.script;
    if (!script || script[field] === value) return;
    this.setState({
      script: { ...script, [field]: value },
      revision: this.stateValue.revision + 1,
      status: "ready",
      error: null,
    });
    this.schedule();
  }

  needsSave(): boolean {
    return this.stateValue.revision !== this.stateValue.savedRevision || this.saving !== null;
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (!this.stateValue.script || !this.stateValue.document) return;
    if (!this.saving) {
      this.saving = this.drain().finally(() => {
        this.saving = null;
      });
    }
    return this.saving;
  }

  async prepareToClose(): Promise<boolean> {
    try {
      await this.flush();
      return true;
    } catch {
      return false;
    }
  }

  async exportPdf(): Promise<void> {
    await this.flush();
    const current = this.current();
    const { renderPdf } = await import("../export/pdf");
    const bytes = await renderPdf(current.script, current.document, derive(current.document));
    await this.repository.exportFile(`${fileStem(current.script.title)}.pdf`, "pdf", bytes);
  }

  async exportScenes(): Promise<void> {
    await this.flush();
    const current = this.current();
    const csv = scenesCsv(derive(current.document).scenes);
    await this.repository.exportFile(
      `${fileStem(current.script.title)}-scenes.csv`,
      "csv",
      new TextEncoder().encode(csv),
    );
  }

  private load(opened: { root: string; text: string | null }) {
    this.generation += 1;
    this.clearTimer();
    const script = storedScript(opened.root, opened.text);
    this.stateValue = {
      status: "ready",
      script,
      document: elementsDocument(script.elements),
      revision: 0,
      savedRevision: 0,
      error: null,
    };
    this.emit();
  }

  private async drain(): Promise<void> {
    const generation = this.generation;
    try {
      while (this.generation === generation && this.stateValue.savedRevision !== this.stateValue.revision) {
        const revision = this.stateValue.revision;
        const { script, document } = this.current();
        this.setState({ status: "saving" });
        await this.repository.saveScript(
          serializeScript({ ...script, elements: storableElements(document) }),
        );
        if (this.generation !== generation) return;
        this.setState({ savedRevision: revision, status: "ready", error: null });
      }
    } catch (error) {
      if (this.generation !== generation) return;
      this.fail(error);
      throw error;
    }
  }

  private current(): { script: Script; document: DocumentSnapshot } {
    const { script, document } = this.stateValue;
    if (!script || !document) throw new Error("No script is open.");
    return { script, document };
  }

  private schedule() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, this.autosaveDelay);
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private fail(error: unknown) {
    this.setState({ status: "error", error: message(error) });
  }

  private setState(change: Partial<SessionState>) {
    this.stateValue = { ...this.stateValue, ...change };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.stateValue);
  }
}

function fileStem(title: string): string {
  const stem = title.trim().replace(/[\\/:*?"<>|]/g, "-");
  return stem || "Untitled";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
