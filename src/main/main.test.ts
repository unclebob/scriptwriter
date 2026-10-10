// @vitest-environment jsdom
// main.ts runs once, on import. Later cases continue from that document.

import { EditorView } from "@codemirror/view";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ScriptSession, type SessionState } from "../application/session";
import { elementsDocument, normalizeElements } from "../domain/document";
import { ELEMENT_LABEL } from "../domain/elements";
import * as derived from "../projections/derived";
import type { OutlineRow } from "../projections/scenes";

const bridge = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault(): void }) => Promise<void> | void;
  const handlers: CloseHandler[] = [];
  return {
    handlers,
    destroy: vi.fn(async () => undefined),
    onCloseRequested: vi.fn(async (handler: CloseHandler) => {
      handlers.push(handler);
    }),
    invoke: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: bridge.onCloseRequested,
    destroy: bridge.destroy,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));

type Box = { top: number; left: number; right: number; bottom: number; width?: number; height?: number };
type ChooseResult = { root: string; text: string | null } | null;

const screenplay = normalizeElements([
  { type: "act", text: "Act One" },
  { type: "scene", text: "INT. KITCHEN" },
  { type: "action", text: "Bob waits." },
  { type: "scene", text: "EXT. ROAD" },
]);
const placed = elementsDocument(screenplay);
const lineStarts = startPositions(placed.text);
const destinations = lineStarts.map((pos) => {
  const element = placed.elements.find((item) => item.from === pos);
  return { pos, name: element ? ELEMENT_LABEL[element.type] : "Blank" };
});
const kettle = JSON.stringify({
  title: "The Kettle",
  credit: "Written by",
  author: "Ada",
  draft: "Second",
  contact: "ada@example.com",
  elements: [
    { type: "act", text: "Act One" },
    { type: "scene", text: "INT. KITCHEN" },
    { type: "action", text: "Bob waits." },
    { type: "scene", text: "EXT. ROAD" },
  ],
});

const geometry = {
  content: { top: 100, left: 200, right: 400, bottom: 240 },
  page: { top: 40, left: 0, right: 500, bottom: 800 },
  format: { top: 0, left: 0, right: 50, bottom: 40, width: 50, height: 40 },
  lines: [
    { top: 90, bottom: 110, left: 0, right: 0 },
    { top: 140, bottom: 155, left: 0, right: 0 },
    { top: 170, bottom: 185, left: 0, right: 0 },
    { top: 190, bottom: 200, left: 0, right: 0 },
    { top: 205, bottom: 215, left: 0, right: 0 },
    { top: 218, bottom: 225, left: 0, right: 0 },
    { top: 230, bottom: 241, left: 0, right: 0 },
  ] as Box[],
  svg: { top: 118, bottom: 124, left: 0, right: 0 },
};

const stateDescriptor = Object.getOwnPropertyDescriptor(ScriptSession.prototype, "state");
const stateGetter = stateDescriptor?.get;
if (!stateGetter || !stateDescriptor) throw new Error("ScriptSession.state is not a getter");
let hideDocument = false;
Object.defineProperty(ScriptSession.prototype, "state", {
  configurable: true,
  get() {
    const value = stateGetter.call(this) as SessionState;
    if (!hideDocument) return value;
    return { ...value, document: null };
  },
});

const realDerive = derived.derive;
let outlineOverride: readonly OutlineRow[] | null = null;
vi.spyOn(derived, "derive").mockImplementation((document) => {
  const value = realDerive(document);
  if (!outlineOverride) return value;
  return { ...value, outline: outlineOverride };
});

const originalRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function rectForTests(): DOMRect {
  if (this.id === "menu-format") return makeRect(geometry.format);
  if (this.classList.contains("cm-content")) return makeRect(geometry.content);
  if (this.classList.contains("page")) return makeRect(geometry.page);
  if (this.classList.contains("cm-line")) {
    if (this.namespaceURI === "http://www.w3.org/2000/svg") return makeRect(geometry.svg);
    const host = this.parentElement;
    const lines = host
      ? [...host.querySelectorAll(".cm-line")].filter((node) => node instanceof HTMLElement)
      : [];
    return makeRect(geometry.lines[lines.indexOf(this)] ?? { top: 0, left: 0, right: 0, bottom: 0 });
  }
  return makeRect({ top: 0, left: 0, right: 0, bottom: 0 });
};

let marginFrames = 0;
const nativeFrame = window.requestAnimationFrame.bind(window);
vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
  if ((new Error().stack ?? "").includes("placeMarginLabel")) {
    marginFrames += 1;
    return 0;
  }
  return nativeFrame(callback);
});

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const emptyRects = () => {
  const list = [] as unknown as DOMRectList;
  list.item = () => null;
  return list;
};
const originalClientRects = Range.prototype.getClientRects;
const originalRangeRect = Range.prototype.getBoundingClientRect;
Range.prototype.getClientRects = emptyRects;
Range.prototype.getBoundingClientRect = () => makeRect({ top: 0, left: 0, right: 0, bottom: 0 });

type DomPos = { node: Node; offset: number };
let domMode: "auto" | "null" | "mismatch" = "auto";
let forcedPos: "auto" | "null" = "auto";
const originalDomAtPos = EditorView.prototype.domAtPos;
vi.spyOn(EditorView.prototype, "domAtPos").mockImplementation(function (this: EditorView, pos: number, side?: -1 | 1) {
  if (domMode === "auto" && forcedPos === "auto" && pos !== 1) return originalDomAtPos.call(this, pos, side);
  return nodeForPos(pos);
});
vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation(() => coordsAtPos());
vi.spyOn(EditorView.prototype, "posAtCoords").mockImplementation((...args: [{ x: number; y: number }, boolean?]) => {
  return positionForClick(args[0], args[1] !== false);
});

let coords: { top: number; left: number; right: number; bottom: number } | null = null;
let nextChoose: ChooseResult | Promise<ChooseResult> = null;
let saveError: Error | null = null;
let exportError: Error | null = null;
const saves: string[] = [];
const exportsSeen: { suggestedName: string; extension: string }[] = [];

bridge.invoke.mockImplementation(async (command: string, args?: { text?: string; suggestedName?: string; extension?: string }) => {
  if (command === "load_startup_script") return { root: "/startup", text: null };
  if (command === "choose_script") return await nextChoose;
  if (command === "commit_script") return undefined;
  if (command === "save_active_script") {
    if (saveError) throw saveError;
    saves.push(args?.text ?? "");
    return undefined;
  }
  if (command === "export_file") {
    if (exportError) throw exportError;
    exportsSeen.push({ suggestedName: args?.suggestedName ?? "", extension: args?.extension ?? "" });
    return true;
  }
  throw new Error(`unexpected command ${command}`);
});

document.body.innerHTML = `
  <div class="app">
    <header class="top">
      <nav class="menubar">
        <div class="menu">
          <button id="btn-file" type="button" aria-haspopup="true" aria-expanded="false">File</button>
          <div id="menu-file" class="menu-list" hidden>
            <button type="button" data-action="open">Open Script<kbd>⌘O</kbd></button>
            <button type="button" data-action="pdf">Export PDF<kbd>⌘⇧E</kbd></button>
            <button type="button" data-action="scenes">Export Scenes<kbd>⌘⇧L</kbd></button>
            <button type="button" data-action="schedule">Shooting Schedule</button>
          </div>
        </div>
        <div class="menu">
          <button id="btn-edit" type="button" aria-haspopup="true" aria-expanded="false">Edit</button>
          <div id="menu-edit" class="menu-list" hidden>
            <button type="button" data-action="find">Find<kbd>⌘F</kbd></button>
          </div>
        </div>
      </nav>
      <input id="script-title" class="script-title" aria-label="Title" spellcheck="false" />
    </header>
    <div id="warnings" class="warnings" hidden></div>
    <div class="workspace">
      <aside>
        <label>Credit <input id="field-credit" type="text" spellcheck="false" /></label>
        <label>Author <input id="field-author" type="text" spellcheck="false" /></label>
        <label>Draft <input id="field-draft" type="text" spellcheck="false" /></label>
        <label>Contact <textarea id="field-contact" rows="4" spellcheck="false"></textarea></label>
        <h2>Scenes</h2>
        <nav id="scenes" aria-label="Scenes"></nav>
      </aside>
      <main id="stage" class="stage">
        <div class="page">
          <div id="margin-label" class="margin-label" hidden></div>
          <div id="editor-host"></div>
        </div>
      </main>
    </div>
    <footer class="status">
      <span id="element-name"></span>
      <span id="page-name"></span>
    </footer>
  </div>
  <div id="menu-format" class="menu-list" hidden></div>
`;

await import("./main");

const mounted = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
if (!mounted) throw new Error("editor was not mounted");
const view: EditorView = mounted;

const warnings = required("#warnings");
const fileButton = requiredButton("#btn-file");
const editButton = requiredButton("#btn-edit");
const fileMenu = required("#menu-file");
const editMenu = required("#menu-edit");
const formatMenu = required("#menu-format");
const marginLabel = required("#margin-label");
const titleInput = requiredField("#script-title");
const actPos = destination(0).pos;
const roadPos = placed.elements.filter((element) => element.type === "scene")[1]?.from;
if (roadPos === undefined) throw new Error("screenplay has no second scene");

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

describe("screen shell", () => {
  afterAll(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    Range.prototype.getClientRects = originalClientRects;
    Range.prototype.getBoundingClientRect = originalRangeRect;
    Object.defineProperty(ScriptSession.prototype, "state", stateDescriptor);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    hideDocument = false;
    outlineOverride = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.title = "";
  });

  it("loads an empty folder, warns once, and unlocks the page", async () => {
    expect(lineStarts).toHaveLength(geometry.lines.length);
    expect(destinations[0]).toMatchObject({ pos: 0, name: "Act" });
    await vi.waitFor(() => expect(warnings.textContent).toContain("script.json"));
    expect(warnings.hidden).toBe(false);
    expect(document.title).toBe("Scriptwriter");
    expect(titleInput.value).toBe("");
    expect(editingOpen()).toBe(true);
    expect(elementName()).toBe("Scene Heading");
    expect(pageName()).toMatch(/^Page \d+ of \d+$/);
    const [only] = sceneButtons();
    expect(only?.textContent).toBe("1  Scene");
    expect(only?.className).toBe("scene");
    expect(only?.getAttribute("aria-current")).toBe("true");
    expect(marginLabel.hidden).toBe(true);
  });

  it("toggles file and edit menus, and leaves them shut from a click or Escape", () => {
    fileButton.click();
    expect(fileMenu.hidden).toBe(false);
    expect(fileButton.getAttribute("aria-expanded")).toBe("true");
    expect(editMenu.hidden).toBe(true);
    fileMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fileMenu.hidden).toBe(false);
    document.querySelector("#stage")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(fileMenu.hidden).toBe(false);
    document.querySelector("#stage")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fileMenu.hidden).toBe(true);
    expect(editMenu.hidden).toBe(true);
    expect(fileButton.getAttribute("aria-expanded")).toBe("false");

    editButton.click();
    expect(editMenu.hidden).toBe(false);
    expect(editButton.getAttribute("aria-expanded")).toBe("true");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(editMenu.hidden).toBe(true);
    expect(editButton.getAttribute("aria-expanded")).toBe("false");
    expect(formatMenu.hidden).toBe(true);
  });

  it("locks editing while a script is being chosen, then restores it when the dialog is cancelled", async () => {
    const pending = defer<ChooseResult>();
    nextChoose = pending.promise;
    requiredButton('[data-action="open"]').click();
    expect(editingOpen()).toBe(false);
    expect(fields().every((field) => field.disabled)).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    pending.resolve(null);
    await vi.waitFor(() => expect(editingOpen()).toBe(true));
    expect(titleInput.value).toBe("");
  });

  it("shows a choose failure and keeps the previous page", async () => {
    nextChoose = Promise.reject(new Error("choose failed"));
    requiredButton('[data-action="open"]').click();
    await vi.waitFor(() => expect(warnings.textContent).toBe("choose failed"));
    expect(warnings.hidden).toBe(false);
    await vi.waitFor(() => expect(editingOpen()).toBe(true));
  });

  it("opens a screenplay into the title, outline, and editor", async () => {
    await openKettle();
    expect(document.title).toBe("The Kettle");
    expect(titleInput.value).toBe("The Kettle");
    expect(requiredField("#field-credit").value).toBe("Written by");
    expect(requiredField("#field-author").value).toBe("Ada");
    expect(requiredField("#field-draft").value).toBe("Second");
    expect(requiredField("#field-contact").value).toBe("ada@example.com");
    expect(warnings.hidden).toBe(true);
    expect(warnings.textContent).toBe("");
    expect(editingOpen()).toBe(true);
    expect(view.state.doc.toString()).toBe(placed.text);
    expect(elementName()).toBe("Act");
    const buttons = sceneButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(["Act One", "1  INT. KITCHEN", "2  EXT. ROAD"]);
    expect(buttons.map((button) => button.className)).toEqual(["scene outline-act", "scene", "scene"]);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("true");
    expect(buttons[1]?.hasAttribute("aria-current")).toBe(false);
    expect(buttons[2]?.hasAttribute("aria-current")).toBe(false);
    const first = buttons[0];
    moveCursor(2);
    expect(sceneButtons()[0]).toBe(first);
  });

  it("marks only the scene that contains the cursor, including its first and last positions", () => {
    sceneButtons()[1]?.click();
    expect(cursor()).toBe(destinations[2]?.pos);
    expect(currentScenes()).toEqual(["1  INT. KITCHEN"]);
    sceneButtons()[2]?.click();
    expect(cursor()).toBe(roadPos);
    expect(elementName()).toBe("Scene Heading");
    expect(currentScenes()).toEqual(["2  EXT. ROAD"]);
  });

  it("places, hides, and clears the margin name", () => {
    moveCursor(actPos);
    coords = { top: 150, left: 10, right: 20, bottom: 160 };
    const shown = marginFrames;
    reposition();
    expect(marginLabel.hidden).toBe(false);
    expect(marginLabel.textContent).toBe("Act");
    expect(marginLabel.style.top).toBe("110px");
    expect(marginFrames).toBe(shown);

    coords = null;
    const hidden = marginFrames;
    expect(() => reposition()).not.toThrow();
    expect(marginLabel.hidden).toBe(true);
    expect(marginLabel.textContent).toBe("Act");
    expect(marginFrames).toBe(hidden + 1);

    coords = { top: 150, left: 10, right: 20, bottom: 160 };
    const cleared = marginFrames;
    moveCursor(destinations[1]?.pos ?? 0);
    expect(elementName()).toBe("Blank");
    expect(marginLabel.hidden).toBe(true);
    expect(marginLabel.textContent).toBe("");
    expect(marginFrames).toBe(cleared);
  });

  it("moves the cursor from a margin click and rejects the boundary misses", () => {
    domMode = "auto";
    forcedPos = "auto";
    expect(cmLines()).toHaveLength(lineStarts.length);

    expect(clickMargin(100, 105)).toBe(actPos);
    expect(elementName()).toBe("Act");
    moveCursor(roadPos);
    expect(clickMargin(500, 105)).toBe(actPos);

    moveCursor(roadPos);
    expect(clickMargin(100, 98)).toBe(actPos);
    moveCursor(actPos);
    expect(clickMargin(100, 242)).toBe(roadPos);
    expect(elementName()).toBe("Scene Heading");

    moveCursor(roadPos);
    expect(clickMargin(100, 90)).toBe(roadPos);
    expect(clickMargin(100, 120)).toBe(roadPos);
    expect(clickMargin(300, 105)).toBe(roadPos);
    expect(clickMargin(199, 105)).toBe(roadPos);
    expect(clickMargin(401, 105)).toBe(roadPos);

    moveCursor(roadPos);
    expect(clickMargin(100, 139)).toBe(destinations[1]?.pos);
    expect(elementName()).toBe("Blank");
    moveCursor(roadPos);
    expect(clickMargin(100, 156)).toBe(destinations[1]?.pos);

    forcedPos = "null";
    moveCursor(roadPos);
    expect(() => clickMargin(100, 105)).not.toThrow();
    expect(cursor()).toBe(roadPos);
    forcedPos = "auto";

    domMode = "null";
    expect(() => clickMargin(100, 105)).not.toThrow();
    expect(cursor()).toBe(roadPos);
    domMode = "mismatch";
    expect(clickMargin(100, 105)).toBe(roadPos);
    domMode = "auto";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("cm-line");
    view.contentDOM.prepend(svg);
    expect(clickMargin(100, 120)).toBe(roadPos);
    svg.remove();
  });

  it("opens the format menu on the act, clamped inside the window", () => {
    moveCursor(actPos);
    setWindow(200, 180);
    marginLabel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 1000 }));
    expect(formatMenu.hidden).toBe(false);
    expect(formatMenu.style.position).toBe("fixed");
    expect(formatMenu.style.left).toBe("142px");
    expect(formatMenu.style.top).toBe("132px");
    const act = formatItem("act");
    const scene = formatItem("scene");
    expect(act.classList.contains("is-current")).toBe(true);
    expect(act.getAttribute("aria-current")).toBe("true");
    expect(scene.classList.contains("is-current")).toBe(false);
    expect(scene.hasAttribute("aria-current")).toBe(false);

    moveCursor(destinations[1]?.pos ?? 0);
    marginLabel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 1000 }));
    expect([...formatMenu.querySelectorAll("button")].some((item) => item.classList.contains("is-current"))).toBe(false);

    moveCursor(actPos);
    marginLabel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 1000 }));
    formatItem("action").click();
    expect(formatMenu.hidden).toBe(true);
    expect(formatMenu.style.left).toBe("");
    expect(elementName()).toBe("Action");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(formatMenu.hidden).toBe(true);
  });

  it("does not apply a load that has a script and no document", async () => {
    hideDocument = true;
    nextChoose = {
      root: "/other",
      text: JSON.stringify({ title: "Other", elements: [{ type: "action", text: "Nope." }] }),
    };
    requiredButton('[data-action="open"]').click();
    await vi.waitFor(() => expect(editingOpen()).toBe(true));
    expect(document.title).toBe("The Kettle");
    expect(titleInput.value).toBe("The Kettle");
    hideDocument = false;
    await openKettle();
    expect(elementName()).toBe("Act");
  });

  it("rebuilds the outline when a scene number is zero and then absent", async () => {
    outlineOverride = [{ kind: "scene", text: "ZERO", from: 5, number: 0 }];
    await openKettle();
    expect(sceneButtons().map((button) => button.textContent)).toEqual(["0  ZERO"]);
    outlineOverride = [{ kind: "scene", text: "ZERO", from: 5, number: null }];
    await openKettle();
    expect(sceneButtons().map((button) => button.textContent)).toEqual(["ZERO"]);
    outlineOverride = null;
    await openKettle();
    expect(sceneButtons()[0]?.textContent).toBe("Act One");
  });

  it("writes header fields through to the title and the save", async () => {
    let prevented = false;
    await closeRequest(() => {
      prevented = true;
    });
    expect(prevented).toBe(false);

    typeInto(titleInput, "");
    expect(document.title).toBe("Scriptwriter");
    typeInto(titleInput, "Again");
    bridge.destroy.mockRejectedValueOnce(new Error("no window"));
    await closeRequest(() => undefined);
    expect(warnings.hidden).toBe(false);
    expect(warnings.textContent).toBe("no window");

    saveError = new Error("disk");
    typeInto(titleInput, "Unsaved");
    const beforeDestroy = bridge.destroy.mock.calls.length;
    await closeRequest(() => undefined);
    expect(warnings.textContent).toBe("disk");
    expect(bridge.destroy.mock.calls.length).toBe(beforeDestroy);
    saveError = null;

    typeInto(titleInput, "Renamed");
    expect(document.title).toBe("Renamed");
    typeInto(requiredField("#field-credit"), "By");
    typeInto(requiredField("#field-author"), "Ada Lovelace");
    typeInto(requiredField("#field-draft"), "Final");
    typeInto(requiredField("#field-contact"), "ada@example.com");
    prevented = false;
    await closeRequest(() => {
      prevented = true;
    });
    expect(prevented).toBe(true);
    expect(saves.at(-1)).toContain('"title": "Renamed"');
    expect(saves.at(-1)).toContain('"credit": "By"');
    expect(saves.at(-1)).toContain('"author": "Ada Lovelace"');
    expect(saves.at(-1)).toContain('"draft": "Final"');
    expect(saves.at(-1)).toContain('"contact": "ada@example.com"');
  });

  it("exports, finds, and handles the keyboard shortcuts", async () => {
    editButton.click();
    requiredButton('[data-action="find"]').click();
    expect(editMenu.hidden).toBe(true);
    expect(document.querySelector(".cm-search")).not.toBeNull();

    exportError = new Error("export failed");
    requiredButton('[data-action="pdf"]').click();
    await vi.waitFor(() => expect(warnings.textContent).toBe("export failed"));
    exportError = null;
    const before = exportsSeen.length;
    requiredButton('[data-action="scenes"]').click();
    await vi.waitFor(() => expect(exportsSeen.length).toBe(before + 1));
    expect(exportsSeen.at(-1)?.extension).toBe("csv");
    requiredButton('[data-action="schedule"]').click();
    await vi.waitFor(() => expect(exportsSeen.at(-1)?.suggestedName).toContain("shooting-schedule.pdf"));

    nextChoose = null;
    const openKey = key("o", { metaKey: true });
    expect(openKey.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(editingOpen()).toBe(true));

    const pdfKey = key("E", { metaKey: true, shiftKey: true });
    expect(pdfKey.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(exportsSeen.filter((item) => item.extension === "pdf").length).toBeGreaterThan(0));
    const scenesKey = key("l", { metaKey: true, shiftKey: true });
    expect(scenesKey.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(exportsSeen.filter((item) => item.extension === "csv").length).toBeGreaterThan(1));
    expect(fileMenu.hidden).toBe(true);
  });
});

function startPositions(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) if (text[index] === "\n") starts.push(index + 1);
  return starts;
}

function makeRect(box: Box): DOMRect {
  const top = box.top;
  const left = box.left;
  const width = box.width ?? box.right - left;
  const height = box.height ?? box.bottom - top;
  const right = box.right ?? left + width;
  const bottom = box.bottom ?? top + height;
  return { x: left, y: top, width, height, top, left, right, bottom, toJSON: () => ({}) };
}

function coordsAtPos(): { top: number; left: number; right: number; bottom: number } | null {
  return coords;
}

function positionForClick(coordsAt: { x: number; y: number }, precise: boolean): number | null {
  if (precise !== false || forcedPos === "null") return null;
  if (coordsAt.x !== 201 && coordsAt.x !== 399) return null;
  const index = geometry.lines.findIndex((line) => coordsAt.y >= line.top - 1 && coordsAt.y <= line.bottom + 1);
  return destinations[index >= 0 ? index : 0]?.pos ?? 0;
}

function nodeForPos(pos: number): DomPos {
  const lines = cmLines();
  if (domMode === "null") return { node: document.createTextNode(""), offset: 0 };
  if (pos === 1) return { node: lines[1] ?? document.createTextNode(""), offset: 0 };
  const index = indexForPos(pos);
  if (domMode === "mismatch") return { node: lines[index === 0 ? 1 : 0] ?? document.createTextNode(""), offset: 0 };
  return { node: lines[index] ?? document.createTextNode(""), offset: 0 };
}

function indexForPos(pos: number): number {
  let index = 0;
  for (let line = 0; line < lineStarts.length; line += 1) if (lineStarts[line] <= pos) index = line;
  return index;
}

function cmLines(): HTMLElement[] {
  return [...document.querySelectorAll(".cm-content .cm-line")].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function required(selector: string): HTMLElement {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return found;
}

function requiredButton(selector: string): HTMLButtonElement {
  const found = required(selector);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${selector}`);
  return found;
}

function requiredField(selector: string): HTMLInputElement | HTMLTextAreaElement {
  const found = required(selector);
  if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) throw new Error(`missing field ${selector}`);
  return found;
}

function fields(): Array<HTMLInputElement | HTMLTextAreaElement> {
  return ["#script-title", "#field-credit", "#field-author", "#field-draft", "#field-contact"].map(requiredField);
}

function editingOpen(): boolean {
  return fields().every((field) => !field.disabled) && view.contentDOM.getAttribute("contenteditable") === "true";
}

function sceneButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll("#scenes button")].filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
}

function currentScenes(): string[] {
  return sceneButtons().filter((button) => button.getAttribute("aria-current") === "true").map((button) => button.textContent ?? "");
}

function elementName(): string {
  return document.querySelector("#element-name")?.textContent ?? "";
}

function pageName(): string {
  return document.querySelector("#page-name")?.textContent ?? "";
}

function cursor(): number {
  return view.state.selection.main.head;
}

function moveCursor(pos: number) {
  view.dispatch({ selection: { anchor: pos } });
}

function destination(index: number): { pos: number; name: string } {
  const found = destinations[index];
  if (!found) throw new Error(`missing line ${index}`);
  return found;
}

function reposition() {
  document.querySelector("#stage")!.dispatchEvent(new Event("scroll"));
}

function clickMargin(x: number, y: number): number {
  document.querySelector(".page")!.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
  );
  return cursor();
}

function formatItem(type: string): HTMLButtonElement {
  const found = formatMenu.querySelector(`[data-element="${type}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing format ${type}`);
  return found;
}

function setWindow(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(name: string, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { ...init, key: name, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

async function closeRequest(preventDefault: () => void) {
  const handler = bridge.handlers[0];
  if (!handler) throw new Error("close handler was not registered");
  await handler({ preventDefault });
}

async function openKettle() {
  const pending = defer<ChooseResult>();
  nextChoose = pending.promise;
  requiredButton('[data-action="open"]').click();
  expect(editingOpen()).toBe(false);
  pending.resolve({ root: "/script", text: kettle });
  await vi.waitFor(() => expect(editingOpen()).toBe(true));
  expect(view.state.doc.toString()).toBe(placed.text);
  expect(titleInput.value).toBe("The Kettle");
}

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
