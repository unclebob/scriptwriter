import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriScriptRepository } from "./tauriRepository";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("native repository adapter", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("uses script-specific commands without renderer-supplied paths", async () => {
    vi.mocked(invoke).mockResolvedValue({ root: "/script", text: null });
    const repository = new TauriScriptRepository();
    await repository.loadStartup();
    await repository.saveScript("{}");
    expect(invoke).toHaveBeenNthCalledWith(1, "load_startup_script");
    expect(invoke).toHaveBeenNthCalledWith(2, "save_active_script", { text: "{}" });
  });

  it("commits an opened folder without a renderer path", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const repository = new TauriScriptRepository();
    await repository.commitScript();
    expect(invoke).toHaveBeenCalledWith("commit_script");
  });

  it("asks the native shell to choose a script", async () => {
    vi.mocked(invoke).mockResolvedValue({ root: "/script", text: null });
    const repository = new TauriScriptRepository();
    await expect(repository.chooseScript()).resolves.toEqual({ root: "/script", text: null });
    expect(invoke).toHaveBeenCalledWith("choose_script");
  });

  it("asks the native shell to watch the companion's script", async () => {
    vi.mocked(invoke).mockResolvedValue({ changed: true, text: "{\"title\":\"Remote\"}" });
    const repository = new TauriScriptRepository();
    await expect(repository.readExternal()).resolves.toEqual({ changed: true, text: "{\"title\":\"Remote\"}" });
    await repository.acknowledgeExternal("{\"title\":\"Remote\"}");
    await repository.ensureCompanion();
    await repository.stopCompanion();
    expect(invoke).toHaveBeenNthCalledWith(1, "read_external_script");
    expect(invoke).toHaveBeenNthCalledWith(2, "acknowledge_script", { text: "{\"title\":\"Remote\"}" });
    expect(invoke).toHaveBeenNthCalledWith(3, "ensure_companion");
    expect(invoke).toHaveBeenNthCalledWith(4, "stop_companion");
  });

  it("passes export bytes to the native save-dialog operation", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    const repository = new TauriScriptRepository();
    await repository.exportFile("Draft.pdf", "pdf", new Uint8Array([1, 2, 3]));
    expect(invoke).toHaveBeenCalledWith("export_file", {
      suggestedName: "Draft.pdf",
      extension: "pdf",
      bytes: [1, 2, 3],
    });
  });
});
