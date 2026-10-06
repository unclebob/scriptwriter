import { describe, expect, it, vi } from "vitest";
import { elementsDocument, normalizeElements } from "../domain/document";
import type { OpenedScript, ScriptRepository } from "../infrastructure/repository";
import { ScriptSession } from "./session";

class FakeRepository implements ScriptRepository {
  saved: string[] = [];
  startup: OpenedScript = { root: "/one", text: JSON.stringify({ title: "One", elements: [] }) };
  selected: OpenedScript | null = null;
  saveHook: (() => Promise<void>) | null = null;

  async loadStartup(): Promise<OpenedScript> {
    return this.startup;
  }

  chooseHook: (() => void) | null = null;
  commits = 0;

  async chooseScript(): Promise<OpenedScript | null> {
    this.chooseHook?.();
    return this.selected;
  }

  async commitScript(): Promise<void> {
    this.commits += 1;
  }

  async saveScript(text: string): Promise<void> {
    this.saved.push(text);
    if (this.saveHook) await this.saveHook();
  }

  exported: { name: string; extension: "pdf" | "csv"; bytes: Uint8Array }[] = [];

  async exportFile(name: string, extension: "pdf" | "csv", bytes: Uint8Array): Promise<boolean> {
    this.exported.push({ name, extension, bytes });
    return true;
  }
}

describe("script session", () => {
  it("adopts the loaded document only while the script is clean", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    const loaded = elementsDocument(normalizeElements([{ type: "action", text: "Loaded." }]));
    session.adoptLoadedDocument(loaded);
    expect(session.state.document).toBeNull();
    await session.start();
    session.adoptLoadedDocument(loaded);
    expect(session.state.document?.text).toBe("Loaded.");
    expect(session.needsSave()).toBe(false);
    session.setHeader("title", "Dirty");
    const later = elementsDocument(normalizeElements([{ type: "action", text: "Later." }]));
    session.adoptLoadedDocument(later);
    expect(session.state.document?.text).toBe("Loaded.");
  });

  it("loads, edits, and saves the latest typed revision", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setHeader("title", "Changed");
    session.setDocument(elementsDocument(normalizeElements([{ type: "action", text: "INT. IS PLAIN TEXT" }])));
    await session.flush();
    expect(repository.saved).toHaveLength(1);
    expect(JSON.parse(repository.saved[0])).toMatchObject({
      title: "Changed",
      elements: [{ type: "action", text: "INT. IS PLAIN TEXT" }],
    });
    expect(session.needsSave()).toBe(false);
  });

  it("drains an edit made while a save is in flight", async () => {
    const repository = new FakeRepository();
    let release: (() => void) | undefined;
    repository.saveHook = () => new Promise<void>((resolve) => { release = resolve; });
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setHeader("title", "First");
    const saving = session.flush();
    await vi.waitFor(() => expect(repository.saved).toHaveLength(1));
    session.setHeader("title", "Latest");
    repository.saveHook = null;
    release!();
    await saving;
    expect(repository.saved).toHaveLength(2);
    expect(JSON.parse(repository.saved[1]).title).toBe("Latest");
  });

  it("keeps a failed revision dirty, refuses closure, and can retry", async () => {
    const repository = new FakeRepository();
    repository.saveHook = async () => { throw new Error("disk full"); };
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setHeader("title", "Unsaved");
    expect(await session.prepareToClose()).toBe(false);
    expect(session.needsSave()).toBe(true);
    repository.saveHook = null;
    expect(await session.prepareToClose()).toBe(true);
    expect(session.needsSave()).toBe(false);
  });

  it("flushes before changing the native active script", async () => {
    const repository = new FakeRepository();
    repository.selected = { root: "/two", text: JSON.stringify({ title: "Two", elements: [] }) };
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setHeader("title", "Saved One");
    expect(await session.chooseScript()).toBe(true);
    expect(JSON.parse(repository.saved[0]).title).toBe("Saved One");
    expect(repository.commits).toBe(1);
    expect(session.state.script?.root).toBe("/two");
  });

  it("saves an edit made while the open dialog is up before committing the new folder", async () => {
    const repository = new FakeRepository();
    const order: string[] = [];
    repository.selected = { root: "/two", text: JSON.stringify({ title: "Two", elements: [] }) };
    repository.saveHook = async () => {
      order.push("save");
    };
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    repository.chooseHook = () => session.setHeader("title", "While open");
    const commit = repository.commitScript.bind(repository);
    repository.commitScript = async () => {
      order.push("commit");
      await commit();
    };
    expect(await session.chooseScript()).toBe(true);
    expect(order).toEqual(["save", "commit"]);
    expect(JSON.parse(repository.saved[0]).title).toBe("While open");
    expect(session.state.script?.title).toBe("Two");
    expect(session.needsSave()).toBe(false);
  });

  it("reports state until the listener unsubscribes", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    const seen: string[] = [];
    const stop = session.subscribe((state) => seen.push(state.status));
    expect(seen).toEqual(["empty"]);
    await session.start();
    expect(seen).toEqual(["empty", "loading", "ready"]);
    stop();
    session.setHeader("title", "Later");
    expect(seen).toEqual(["empty", "loading", "ready"]);
  });

  it("reports a startup failure", async () => {
    const repository = new FakeRepository();
    repository.loadStartup = async () => {
      throw new Error("missing");
    };
    const session = new ScriptSession(repository, 60_000);
    await expect(session.start()).rejects.toThrow("missing");
    expect(session.state.status).toBe("error");
    expect(session.state.error).toBe("missing");

    repository.loadStartup = async () => {
      throw "disk";
    };
    const again = new ScriptSession(repository, 60_000);
    await expect(again.start()).rejects.toBe("disk");
    expect(again.state.error).toBe("disk");
  });

  it("keeps the open script when the chooser is cancelled", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    repository.selected = null;
    expect(await session.chooseScript()).toBe(false);
    expect(session.state.script?.root).toBe("/one");
  });

  it("has nothing to flush before a script is open", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.flush();
    expect(repository.saved).toHaveLength(0);
  });

  it("joins a second flush to the save already in flight", async () => {
    const repository = new FakeRepository();
    let release: (() => void) | undefined;
    repository.saveHook = () => new Promise<void>((resolve) => { release = resolve; });
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setHeader("title", "First");
    const first = session.flush();
    const second = session.flush();
    expect(repository.saved).toHaveLength(1);
    release!();
    await first;
    await second;
    expect(repository.saved).toHaveLength(1);
  });

  it("ignores a header write that does not change the value", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setHeader("title", "One");
    expect(session.state.revision).toBe(0);
    expect(session.needsSave()).toBe(false);
  });

  it("ignores edits while the chosen script is being committed", async () => {
    const repository = new FakeRepository();
    repository.selected = { root: "/two", text: JSON.stringify({ title: "Two", elements: [] }) };
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    const commit = repository.commitScript.bind(repository);
    repository.commitScript = async () => {
      session.setHeader("title", "Ignored");
      session.setDocument(elementsDocument(normalizeElements([{ type: "action", text: "Ignored." }])));
      expect(session.state.script?.title).toBe("One");
      expect(session.state.document?.text).toBe("");
      await commit();
    };
    expect(await session.chooseScript()).toBe(true);
    expect(session.state.script?.title).toBe("Two");
    expect(session.needsSave()).toBe(false);
  });

  it("refuses to export when no script is open", async () => {
    const session = new ScriptSession(new FakeRepository(), 60_000);
    await expect(session.exportPdf()).rejects.toThrow("No script is open.");
    await expect(session.exportScenes()).rejects.toThrow("No script is open.");
  });

  it("exports a pdf and a scene list under a safe file name", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    session.setDocument(elementsDocument(normalizeElements([
      { type: "scene", text: "ROOM" },
      { type: "action", text: "Hello." },
    ])));
    session.setHeader("title", "A/B: \"C");
    await session.exportPdf();
    await session.exportScenes();
    expect(repository.exported.map(({ name, extension }) => ({ name, extension }))).toEqual([
      { name: "A-B- -C.pdf", extension: "pdf" },
      { name: "A-B- -C-scenes.csv", extension: "csv" },
    ]);
    expect(repository.exported[0].bytes.byteLength).toBeGreaterThan(0);
    expect(repository.exported[1].bytes.byteLength).toBeGreaterThan(0);

    session.setHeader("title", "   ");
    await session.exportPdf();
    expect(repository.exported[2]).toMatchObject({ name: "Untitled.pdf", extension: "pdf" });
  });

  it("drops a save that finishes after a newer script has loaded", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    repository.startup = { root: "/fresh", text: JSON.stringify({ title: "Fresh", elements: [] }) };
    repository.saveHook = async () => {
      await session.start();
    };
    session.setHeader("title", "Stale");
    await session.flush();
    expect(JSON.parse(repository.saved[0]).title).toBe("Stale");
    expect(session.state.script?.title).toBe("Fresh");
    expect(session.state.status).toBe("ready");
    expect(session.needsSave()).toBe(false);
  });

  it("does not mark the newer script failed when a stale save throws", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    repository.startup = { root: "/fresh", text: JSON.stringify({ title: "Fresh", elements: [] }) };
    repository.saveHook = async () => {
      await session.start();
      throw new Error("stale write");
    };
    session.setHeader("title", "Stale");
    await session.flush();
    expect(session.state.status).toBe("ready");
    expect(session.state.script?.title).toBe("Fresh");
    expect(session.state.error).toBeNull();
  });

  it("saves on the autosave delay", async () => {
    const repository = new FakeRepository();
    const session = new ScriptSession(repository, 60_000);
    await session.start();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      session.setHeader("title", "Later");
      expect(repository.saved).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(repository.saved).toHaveLength(1);
      expect(JSON.parse(repository.saved[0]).title).toBe("Later");
    } finally {
      vi.useRealTimers();
    }
  });
});
