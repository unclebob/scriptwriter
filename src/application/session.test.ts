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

  async chooseScript(): Promise<OpenedScript | null> {
    return this.selected;
  }

  async saveScript(text: string): Promise<void> {
    this.saved.push(text);
    if (this.saveHook) await this.saveHook();
  }

  async exportFile(): Promise<boolean> {
    return true;
  }
}

describe("script session", () => {
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
    expect(session.state.script?.root).toBe("/two");
  });
});
