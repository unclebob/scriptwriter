import "./styles.css";
import { open, save } from "@tauri-apps/plugin-dialog";
import { renderPdf } from "../export/pdf";
import { ELEMENT_LABEL, ELEMENTS, editorDoc, elementAt } from "../internals/fountain";
import { joinPath } from "../internals/path";
import { outline, scenesCsv } from "../internals/scenes";
import { loadScript, saveScript, type Script } from "../internals/script";
import { createEditor, elementLabel, findInScript, marginText, pageLabel, useElement, type ScriptEditor } from "../ui/editor";
import { startupScriptPath, tauriFs } from "../ui/tauriFs";

const fs = tauriFs;
const titleInput = document.querySelector<HTMLInputElement>("#script-title")!;
const creditInput = document.querySelector<HTMLInputElement>("#field-credit")!;
const authorInput = document.querySelector<HTMLInputElement>("#field-author")!;
const draftInput = document.querySelector<HTMLInputElement>("#field-draft")!;
const contactInput = document.querySelector<HTMLTextAreaElement>("#field-contact")!;
const warnings = document.querySelector<HTMLElement>("#warnings")!;
const scenesEl = document.querySelector<HTMLElement>("#scenes")!;
const elementName = document.querySelector<HTMLElement>("#element-name")!;
const pageName = document.querySelector<HTMLElement>("#page-name")!;
const host = document.querySelector<HTMLElement>("#editor-host")!;
const pageEl = document.querySelector<HTMLElement>(".page")!;
const marginLabel = document.querySelector<HTMLElement>("#margin-label")!;
const stage = document.querySelector<HTMLElement>("#stage")!;

let script: Script | null = null;
let saveTimer = 0;
let sceneKey = "";
let pending = Promise.resolve();

const editor: ScriptEditor = createEditor(host, ".", {
  onChange(doc) {
    if (!script) return;
    script.body = doc;
    schedule();
  },
  onCursor(doc, cursor) {
    paint(doc, cursor);
  },
});

for (const name of ["file", "edit"] as const) {
  const button = document.querySelector<HTMLButtonElement>(`#btn-${name}`)!;
  const menu = document.querySelector<HTMLElement>(`#menu-${name}`)!;
  button.addEventListener("click", () => {
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
  });
}

const formatMenu = document.querySelector<HTMLElement>("#menu-format")!;
for (const [index, type] of ELEMENTS.entries()) {
  const item = menuItem(ELEMENT_LABEL[type], `⌘${index + 1}`, () => useElement(editor, type));
  item.dataset.element = type;
  formatMenu.append(item);
}

marginLabel.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openFormatMenu(event.clientX, event.clientY);
});

pageEl.addEventListener("mousedown", (event) => {
  const arrow = event.target instanceof Element ? event.target.closest<HTMLElement>(".insert-above") : null;
  if (arrow) {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = Number(arrow.dataset.from);
    if (!Number.isFinite(from)) return;
    closeMenus();
    editor.insertBefore(from);
    return;
  }
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!inScriptMargin(event)) return;
  const pos = marginPosition(event);
  if (pos == null) return;
  event.preventDefault();
  const element = elementAt(editor.getDoc(), pos);
  editor.goto(element ? element.from + element.marker : pos);
});

stage.addEventListener("scroll", placeMarginLabel);
window.addEventListener("resize", placeMarginLabel);

document.querySelector<HTMLButtonElement>('[data-action="open"]')!.addEventListener("click", () => {
  closeMenus();
  void chooseScript();
});
document.querySelector<HTMLButtonElement>('[data-action="pdf"]')!.addEventListener("click", () => {
  closeMenus();
  void exportPdf();
});
document.querySelector<HTMLButtonElement>('[data-action="scenes"]')!.addEventListener("click", () => {
  closeMenus();
  void exportScenes();
});
document.querySelector<HTMLButtonElement>('[data-action="find"]')!.addEventListener("click", () => {
  closeMenus();
  findInScript(editor);
});

document.addEventListener("click", (event) => {
  if (event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".menu")) return;
  closeMenus();
});

titleInput.addEventListener("input", () => {
  document.title = titleInput.value || "Scriptwriter";
  schedule();
});
for (const field of [creditInput, authorInput, draftInput, contactInput]) {
  field.addEventListener("input", schedule);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "o" && !event.shiftKey) {
    event.preventDefault();
    closeMenus();
    void chooseScript();
  } else if (key === "e" && event.shiftKey) {
    event.preventDefault();
    closeMenus();
    void exportPdf();
  } else if (key === "l" && event.shiftKey) {
    event.preventDefault();
    closeMenus();
    void exportScenes();
  }
});

paint(editor.getDoc(), editor.view.state.selection.main.head);

void startupScriptPath()
  .then((root) => openScript(root))
  .catch((error: unknown) => showWarning(message(error)));

function menuItem(label: string, keys: string, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  const name = document.createElement("span");
  name.textContent = label;
  const kbd = document.createElement("kbd");
  kbd.textContent = keys;
  button.append(name, kbd);
  button.addEventListener("click", () => {
    closeMenus();
    run();
  });
  return button;
}

function closeMenus() {
  for (const name of ["file", "edit"]) {
    const menu = document.querySelector<HTMLElement>(`#menu-${name}`)!;
    const button = document.querySelector<HTMLButtonElement>(`#btn-${name}`)!;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
  formatMenu.hidden = true;
  formatMenu.style.position = "";
  formatMenu.style.left = "";
  formatMenu.style.top = "";
  formatMenu.style.marginTop = "";
  formatMenu.style.zIndex = "";
}

function placeMarginLabel() {
  if (positionMarginLabel()) return;
  requestAnimationFrame(positionMarginLabel);
}

function positionMarginLabel(): boolean {
  const pos = editor.view.state.selection.main.head;
  const name = marginText(editor.getDoc(), pos);
  const coords = editor.view.coordsAtPos(pos);
  if (!coords) {
    marginLabel.hidden = true;
    return false;
  }
  if (!name) {
    marginLabel.hidden = true;
    marginLabel.textContent = "";
    return true;
  }
  const page = pageEl.getBoundingClientRect();
  marginLabel.hidden = false;
  marginLabel.textContent = name;
  marginLabel.style.top = `${coords.top - page.top}px`;
  return true;
}

function openFormatMenu(x: number, y: number) {
  closeMenus();
  markFormat();
  formatMenu.hidden = false;
  formatMenu.style.position = "fixed";
  formatMenu.style.marginTop = "0";
  formatMenu.style.zIndex = "20";
  const rect = formatMenu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 8));
  formatMenu.style.left = `${left}px`;
  formatMenu.style.top = `${top}px`;
}

function markFormat() {
  const element = elementAt(editor.getDoc(), editor.view.state.selection.main.head);
  for (const button of formatMenu.querySelectorAll("button")) {
    const on = element !== null && button.dataset.element === element.type;
    button.classList.toggle("is-current", on);
    if (on) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

/** Beside the text column, and level with a line. Page padding above and below the text is not the margin. */
function inScriptMargin(event: MouseEvent): boolean {
  const box = editor.view.contentDOM.getBoundingClientRect();
  if (event.clientY < box.top - 2 || event.clientY > box.bottom + 2) return false;
  return event.clientX < box.left - 1 || event.clientX > box.right + 1;
}

function marginPosition(event: MouseEvent): number | null {
  const line = lineUnder(event.clientY);
  if (!line) return null;
  const view = editor.view;
  const box = view.contentDOM.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  const pos = view.posAtCoords({ x, y: event.clientY }, false);
  if (pos == null || lineOf(pos) !== line) return null;
  return pos;
}

/** The screen line under this y. Line-block tops are document offsets, not screen positions. */
function lineUnder(clientY: number): HTMLElement | null {
  for (const line of editor.view.contentDOM.querySelectorAll(".cm-line")) {
    if (!(line instanceof HTMLElement)) continue;
    const rect = line.getBoundingClientRect();
    if (clientY >= rect.top - 1 && clientY <= rect.bottom + 1) return line;
  }
  return null;
}

function lineOf(pos: number): HTMLElement | null {
  const view = editor.view;
  const found = view.domAtPos(Math.min(Math.max(pos, 0), view.state.doc.length));
  const node = found.node instanceof Element ? found.node : found.node.parentElement;
  const line = node?.closest(".cm-line");
  return line instanceof HTMLElement ? line : null;
}

function schedule() {
  if (!script) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    pending = pending.then(flush, flush).then(undefined, (error: unknown) => {
      showWarning(message(error));
    });
  }, 400);
}

async function saveNow(): Promise<void> {
  window.clearTimeout(saveTimer);
  pending = pending.then(flush, flush);
  try {
    await pending;
  } catch (error) {
    showWarning(message(error));
    throw error;
  }
}

async function flush(): Promise<void> {
  if (!script) return;
  const next = current();
  script = next;
  await saveScript(fs, next);
  clearWarnings();
}

function current(): Script {
  if (!script) throw new Error("No script is open.");
  return {
    ...script,
    title: titleInput.value,
    credit: creditInput.value,
    author: authorInput.value,
    draft: draftInput.value,
    contact: contactInput.value,
    body: editor.getDoc(),
  };
}

async function openScript(root: string) {
  try {
    await saveNow();
  } catch {
    return;
  }
  let loaded: Script;
  try {
    loaded = await loadScript(fs, root);
  } catch (error) {
    showWarning(message(error));
    return;
  }
  script = loaded;
  fillFields(loaded);
  editor.setDoc(editorDoc(loaded.body));
  script.body = editor.getDoc();
  sceneKey = "";
  if (loaded.warnings.length > 0) showWarning(loaded.warnings.join(" "));
  else clearWarnings();
  paint(editor.getDoc(), editor.view.state.selection.main.head);
  editor.focus();
}

async function chooseScript() {
  const picked = await open({ directory: true, title: "Open Script" });
  if (!picked) return;
  await openScript(picked);
}

async function exportPdf() {
  if (!script) return;
  const next = current();
  const path = await save({
    title: "Export PDF",
    defaultPath: joinPath(next.root, `${fileStem(next.title)}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return;
  try {
    await fs.writeText(path, renderPdf(next));
  } catch (error) {
    showWarning(message(error));
  }
}

async function exportScenes() {
  if (!script) return;
  const next = current();
  const path = await save({
    title: "Export Scenes",
    defaultPath: joinPath(next.root, `${fileStem(next.title)}-scenes.csv`),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;
  try {
    await fs.writeText(path, scenesCsv(next.body));
  } catch (error) {
    showWarning(message(error));
  }
}

function fillFields(loaded: Script) {
  titleInput.value = loaded.title;
  creditInput.value = loaded.credit;
  authorInput.value = loaded.author;
  draftInput.value = loaded.draft;
  contactInput.value = loaded.contact;
  document.title = loaded.title || "Scriptwriter";
}

function paint(doc: string, cursor: number) {
  elementName.textContent = elementLabel(doc, cursor);
  pageName.textContent = pageLabel(doc, cursor);
  paintScenes(doc, cursor);
  placeMarginLabel();
}

function paintScenes(doc: string, cursor: number) {
  const rows = outline(doc);
  const key = rows.map((row) => `${row.kind}\0${row.number ?? ""}\0${row.from}\0${row.text}`).join("\n");
  if (key !== sceneKey) {
    sceneKey = key;
    scenesEl.replaceChildren();
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = row.kind === "act" ? "scene outline-act" : "scene";
      button.textContent = row.number === null ? row.text : `${row.number}  ${row.text}`;
      button.dataset.from = String(row.from);
      button.addEventListener("click", () => {
        const element = elementAt(editor.getDoc(), row.from);
        editor.goto((element?.from ?? row.from) + (element?.marker ?? 0));
      });
      scenesEl.append(button);
    }
  }
  let current: HTMLButtonElement | null = null;
  for (const button of scenesEl.querySelectorAll<HTMLButtonElement>("button")) {
    const from = Number(button.dataset.from);
    if (from <= cursor) current = button;
    button.removeAttribute("aria-current");
  }
  if (current) current.setAttribute("aria-current", "true");
}

function fileStem(title: string): string {
  const cleaned = title.replace(/[/\\?%*:|"<>]/g, "").trim();
  return cleaned || "script";
}

function showWarning(text: string) {
  warnings.hidden = false;
  warnings.textContent = text;
}

function clearWarnings() {
  warnings.hidden = true;
  warnings.textContent = "";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
