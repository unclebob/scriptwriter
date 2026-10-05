import "./styles.css";
import { open, save } from "@tauri-apps/plugin-dialog";
import { renderPdf } from "../export/pdf";
import { ELEMENT_LABEL, ELEMENTS, editorDoc, elementAt } from "../internals/fountain";
import { joinPath } from "../internals/path";
import { outline, scenesCsv, type OutlineRow } from "../internals/scenes";
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
  const coords = editor.view.coordsAtPos(pos);
  if (!coords) return hideMargin();
  return showMargin(marginText(editor.getDoc(), pos), coords.top);
}

function hideMargin(): boolean {
  marginLabel.hidden = true;
  return false;
}

function showMargin(name: string, top: number): boolean {
  if (!name) return clearMargin();
  const page = pageEl.getBoundingClientRect();
  marginLabel.hidden = false;
  marginLabel.textContent = name;
  marginLabel.style.top = `${top - page.top}px`;
  return true;
}

function clearMargin(): boolean {
  marginLabel.hidden = true;
  marginLabel.textContent = "";
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
  const type = currentType();
  for (const button of formatMenu.querySelectorAll("button")) markFormatButton(button, type);
}

function currentType(): string {
  const element = elementAt(editor.getDoc(), editor.view.state.selection.main.head);
  if (!element) return "";
  return element.type;
}

function markFormatButton(button: Element, type: string) {
  if (!(button instanceof HTMLButtonElement)) return;
  setCurrent(button, sameElement(button, type));
}

function sameElement(button: HTMLButtonElement, type: string): boolean {
  return type !== "" && button.dataset.element === type;
}

function setCurrent(button: HTMLButtonElement, on: boolean) {
  button.classList.toggle("is-current", on);
  if (on) button.setAttribute("aria-current", "true");
  else button.removeAttribute("aria-current");
}

/** Beside the text column, and level with a line. Page padding above and below the text is not the margin. */
function inScriptMargin(event: MouseEvent): boolean {
  const box = editor.view.contentDOM.getBoundingClientRect();
  if (outsideY(event.clientY, box)) return false;
  return outsideX(event.clientX, box);
}

function outsideY(y: number, box: DOMRect): boolean {
  return y < box.top - 2 || y > box.bottom + 2;
}

function outsideX(x: number, box: DOMRect): boolean {
  return x < box.left - 1 || x > box.right + 1;
}

function marginPosition(event: MouseEvent): number | null {
  const line = lineUnder(event.clientY);
  if (!line) return null;
  return positionOnLine(event, line);
}

function positionOnLine(event: MouseEvent, line: HTMLElement): number | null {
  const pos = coordsPos(event);
  if (pos === null) return null;
  return posOn(pos, line);
}

function coordsPos(event: MouseEvent): number | null {
  const view = editor.view;
  const box = view.contentDOM.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  return view.posAtCoords({ x, y: event.clientY }, false);
}

function posOn(pos: number, line: HTMLElement): number | null {
  if (lineOf(pos) !== line) return null;
  return pos;
}

/** The screen line under this y. Line-block tops are document offsets, not screen positions. */
function lineUnder(clientY: number): HTMLElement | null {
  return firstLine([...editor.view.contentDOM.querySelectorAll(".cm-line")], clientY);
}

function firstLine(lines: Element[], clientY: number): HTMLElement | null {
  const found = lines.find((line) => containsY(line, clientY));
  return found instanceof HTMLElement ? found : null;
}

function containsY(line: Element, clientY: number): boolean {
  if (!(line instanceof HTMLElement)) return false;
  return insideY(line.getBoundingClientRect(), clientY);
}

function insideY(rect: DOMRect, clientY: number): boolean {
  return clientY >= rect.top - 1 && clientY <= rect.bottom + 1;
}

function lineOf(pos: number): HTMLElement | null {
  const view = editor.view;
  const found = view.domAtPos(Math.min(Math.max(pos, 0), view.state.doc.length));
  return closestLine(found.node);
}

function closestLine(node: Node): HTMLElement | null {
  const element = asElement(node);
  if (!element) return null;
  return htmlLine(element.closest(".cm-line"));
}

function asElement(node: Node): Element | null {
  if (node instanceof Element) return node;
  return node.parentElement;
}

function htmlLine(node: Element | null): HTMLElement | null {
  if (node instanceof HTMLElement) return node;
  return null;
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
  const loaded = await loadAfterSave(root);
  if (loaded) showLoaded(loaded);
}

async function loadAfterSave(root: string): Promise<Script | null> {
  if (!(await saved())) return null;
  return loadOrWarn(root);
}

async function saved(): Promise<boolean> {
  try {
    await saveNow();
    return true;
  } catch {
    return false;
  }
}

async function loadOrWarn(root: string): Promise<Script | null> {
  try {
    return await loadScript(fs, root);
  } catch (error) {
    showWarning(message(error));
    return null;
  }
}

function showLoaded(loaded: Script) {
  script = loaded;
  fillFields(loaded);
  editor.setDoc(editorDoc(loaded.body));
  script.body = editor.getDoc();
  sceneKey = "";
  warnAll(loaded.warnings);
  paint(editor.getDoc(), editor.view.state.selection.main.head);
  editor.focus();
}

function warnAll(list: string[]) {
  if (list.length > 0) showWarning(list.join(" "));
  else clearWarnings();
}

async function chooseScript() {
  const picked = await open({ directory: true, title: "Open Script" });
  if (!picked) return;
  await openScript(picked);
}

async function exportPdf() {
  const next = editing();
  if (!next) return;
  const path = await save({
    title: "Export PDF",
    defaultPath: joinPath(next.root, `${fileStem(next.title)}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  await writeExport(path, renderPdf(next));
}

async function exportScenes() {
  const next = editing();
  if (!next) return;
  const path = await save({
    title: "Export Scenes",
    defaultPath: joinPath(next.root, `${fileStem(next.title)}-scenes.csv`),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  await writeExport(path, scenesCsv(next.body));
}

function editing(): Script | null {
  if (!script) return null;
  return current();
}

async function writeExport(path: string | null, text: string) {
  if (!path) return;
  await writeText(path, text);
}

async function writeText(path: string, text: string) {
  try {
    await fs.writeText(path, text);
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
  const key = outlineKey(rows);
  if (key !== sceneKey) replaceOutline(rows, key);
  markOutline(cursor);
}

function outlineKey(rows: OutlineRow[]): string {
  return rows.map(outlineToken).join("\n");
}

function outlineToken(row: OutlineRow): string {
  return `${row.kind}\0${rowNumber(row)}\0${row.from}\0${row.text}`;
}

function rowNumber(row: OutlineRow): string {
  if (row.number === null) return "";
  return String(row.number);
}

function replaceOutline(rows: OutlineRow[], key: string) {
  sceneKey = key;
  scenesEl.replaceChildren();
  for (const row of rows) scenesEl.append(outlineButton(row));
}

function outlineButton(row: OutlineRow): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = outlineClass(row);
  button.textContent = outlineLabel(row);
  button.dataset.from = String(row.from);
  button.addEventListener("click", () => gotoRow(row.from));
  return button;
}

function outlineClass(row: OutlineRow): string {
  return row.kind === "act" ? "scene outline-act" : "scene";
}

function outlineLabel(row: OutlineRow): string {
  if (row.number === null) return row.text;
  return `${row.number}  ${row.text}`;
}

function gotoRow(from: number) {
  editor.goto(rowCursor(elementAt(editor.getDoc(), from), from));
}

function rowCursor(element: { from: number; marker: number } | null, from: number): number {
  if (!element) return from;
  return element.from + element.marker;
}

function markOutline(cursor: number) {
  const buttons = [...scenesEl.querySelectorAll<HTMLButtonElement>("button")];
  clearCurrent(buttons);
  const current = buttonAt(buttons, cursor);
  if (current) current.setAttribute("aria-current", "true");
}

function clearCurrent(buttons: HTMLButtonElement[]) {
  for (const button of buttons) button.removeAttribute("aria-current");
}

function buttonAt(buttons: HTMLButtonElement[], cursor: number): HTMLButtonElement | null {
  return buttons.reduce<HTMLButtonElement | null>((current, button) => laterButton(current, button, cursor), null);
}

function laterButton(current: HTMLButtonElement | null, button: HTMLButtonElement, cursor: number): HTMLButtonElement | null {
  if (Number(button.dataset.from) <= cursor) return button;
  return current;
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
