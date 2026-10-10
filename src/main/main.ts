import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ScriptSession } from "../application/session";
import { elementAt, type DocumentSnapshot } from "../domain/document";
import type { Script } from "../domain/script";
import { ELEMENT_LABEL, ELEMENTS } from "../domain/elements";
import { TauriScriptRepository } from "../infrastructure/tauriRepository";
import type { OutlineRow } from "../projections/scenes";
import { derive } from "../projections/derived";
import {
  createEditor,
  elementLabel,
  findInScript,
  marginText,
  pageLabel,
  useElement,
  type ScriptEditor,
} from "../editor/adapter";

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

const session = new ScriptSession(new TauriScriptRepository());
let sceneKey = "";
let closing = false;

const fields = [titleInput, creditInput, authorInput, draftInput, contactInput];

const editor: ScriptEditor = createEditor(host, [], {
  onChange(document) {
    session.setDocument(document);
    paint(document, editor.view.state.selection.main.head);
  },
  onCursor(document, cursor) {
    paint(document, cursor);
  },
});
editor.setEditable(false);
setFieldsEnabled(false);

session.subscribe((state) => {
  if (state.error) showWarning(state.error);
  else if (state.status === "ready" && state.revision === state.savedRevision) clearWarnings();
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

marginLabel.addEventListener("contextmenu", showFormatMenu);
marginLabel.addEventListener("click", showFormatMenu);
marginLabel.addEventListener("mousedown", holdFormatClick);

pageEl.addEventListener("mousedown", (event) => {
  const arrow = event.target instanceof Element ? event.target.closest<HTMLElement>(".insert-above") : null;
  if (arrow) {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = Number(arrow.dataset.from);
    if (Number.isFinite(from)) editor.insertBefore(from);
    closeMenus();
    return;
  }
  if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!inScriptMargin(event)) return;
  const pos = marginPosition(event);
  if (pos === null) return;
  event.preventDefault();
  const element = elementAt(editor.getDocument(), pos);
  editor.goto(element?.from ?? pos);
});

stage.addEventListener("scroll", placeMarginLabel);
window.addEventListener("resize", placeMarginLabel);

document.querySelector<HTMLButtonElement>('[data-action="open"]')!.addEventListener("click", () => {
  closeMenus();
  void chooseScript();
});
document.querySelector<HTMLButtonElement>('[data-action="pdf"]')!.addEventListener("click", () => {
  closeMenus();
  void exportFile(() => session.exportPdf());
});
document.querySelector<HTMLButtonElement>('[data-action="scenes"]')!.addEventListener("click", () => {
  closeMenus();
  void exportFile(() => session.exportScenes());
});
document.querySelector<HTMLButtonElement>('[data-action="schedule"]')!.addEventListener("click", () => {
  closeMenus();
  void exportFile(() => session.exportSchedule());
});
document.querySelector<HTMLButtonElement>('[data-action="find"]')!.addEventListener("click", () => {
  closeMenus();
  findInScript(editor);
});

document.addEventListener("click", (event) => {
  if (event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest(".menu")) return;
  closeMenus();
});

titleInput.addEventListener("input", () => {
  document.title = titleInput.value || "Scriptwriter";
  session.setHeader("title", titleInput.value);
});
for (const [field, input] of [
  ["credit", creditInput],
  ["author", authorInput],
  ["draft", draftInput],
  ["contact", contactInput],
] as const) {
  input.addEventListener("input", () => session.setHeader(field, input.value));
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
    void exportFile(() => session.exportPdf());
  } else if (key === "l" && event.shiftKey) {
    event.preventDefault();
    closeMenus();
    void exportFile(() => session.exportScenes());
  }
});

void getCurrentWindow().onCloseRequested(async (event) => {
  if (closing || !session.needsSave()) return;
  event.preventDefault();
  if (await session.prepareToClose()) {
    try {
      closing = true;
      await getCurrentWindow().destroy();
    } catch (error) {
      closing = false;
      showWarning(message(error));
    }
  } else if (session.state.error) {
    showWarning(session.state.error);
  }
});

paint(editor.getDocument(), editor.view.state.selection.main.head);
void session.start().then(showLoaded).catch((error: unknown) => showWarning(message(error)));

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
  return showMargin(marginText(editor.getDocument(), pos), coords.top);
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

function showFormatMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  openFormatMenu(event.clientX, event.clientY);
}

function holdFormatClick(event: MouseEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
}

function openFormatMenu(x: number, y: number) {
  closeMenus();
  markFormat();
  formatMenu.hidden = false;
  formatMenu.style.position = "fixed";
  formatMenu.style.marginTop = "0";
  formatMenu.style.zIndex = "20";
  const rect = formatMenu.getBoundingClientRect();
  formatMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  formatMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
}

function markFormat() {
  const type = currentType();
  for (const item of formatMenu.querySelectorAll("button")) markFormatItem(item, type);
}

function currentType(): string {
  const element = elementAt(editor.getDocument(), editor.view.state.selection.main.head);
  return element ? element.type : "";
}

function markFormatItem(item: Element, type: string) {
  if (!(item instanceof HTMLButtonElement)) return;
  applyFormatMark(item, type);
}

function applyFormatMark(item: HTMLButtonElement, type: string) {
  const current = formatCurrent(item, type);
  item.classList.toggle("is-current", current);
  setAriaCurrent(item, current);
}

function formatCurrent(item: HTMLButtonElement, type: string): boolean {
  return type !== "" && item.dataset.element === type;
}

function setAriaCurrent(item: HTMLButtonElement, current: boolean) {
  if (current) item.setAttribute("aria-current", "true");
  else item.removeAttribute("aria-current");
}

function inScriptMargin(event: MouseEvent): boolean {
  const box = editor.view.contentDOM.getBoundingClientRect();
  return inVerticalBand(event, box) && outsideLine(event, box);
}

function inVerticalBand(event: MouseEvent, box: DOMRect): boolean {
  return event.clientY >= box.top - 2 && event.clientY <= box.bottom + 2;
}

function outsideLine(event: MouseEvent, box: DOMRect): boolean {
  return event.clientX < box.left - 1 || event.clientX > box.right + 1;
}

function marginPosition(event: MouseEvent): number | null {
  const line = lineAtY(editor.view.contentDOM, event.clientY);
  if (!(line instanceof HTMLElement)) return null;
  return positionOnLine(event, line);
}

function lineAtY(root: HTMLElement, y: number): Element | undefined {
  return [...root.querySelectorAll(".cm-line")].find((candidate) => containsY(candidate, y));
}

function containsY(candidate: Element, y: number): boolean {
  const rect = candidate.getBoundingClientRect();
  return y >= rect.top - 1 && y <= rect.bottom + 1;
}

function positionOnLine(event: MouseEvent, line: HTMLElement): number | null {
  const box = editor.view.contentDOM.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  const pos = editor.view.posAtCoords({ x, y: event.clientY }, false);
  if (pos === null) return null;
  return posOnLine(pos, line);
}

function posOnLine(pos: number, line: HTMLElement): number | null {
  const found = editor.view.domAtPos(clampPos(pos));
  return sameLine(nodeElement(found.node), line, pos);
}

function clampPos(pos: number): number {
  return Math.min(Math.max(pos, 0), editor.view.state.doc.length);
}

function nodeElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function sameLine(element: Element | null, line: HTMLElement, pos: number): number | null {
  if (!onLine(element, line)) return null;
  return pos;
}

function onLine(element: Element | null, line: HTMLElement): boolean {
  return !!element && element.closest(".cm-line") === line;
}

async function chooseScript() {
  lockEditing();
  try {
    await openChosen();
  } catch (error) {
    showWarning(message(error));
  } finally {
    restoreEditing();
  }
}

function lockEditing() {
  editor.setEditable(false);
  setFieldsEnabled(false);
}

async function openChosen() {
  if (await session.chooseScript()) showLoaded();
}

function restoreEditing() {
  if (!session.state.script) return;
  editor.setEditable(true);
  setFieldsEnabled(true);
}

function showLoaded() {
  const loaded = loadedScript();
  if (!loaded) return;
  applyLoaded(loaded);
}

function loadedScript() {
  const { script, document: loaded } = session.state;
  if (missingLoaded(script, loaded)) return null;
  return script;
}

function missingLoaded(script: object | null, loaded: object | null): boolean {
  return !script || !loaded;
}

function applyLoaded(script: Script) {
  fillHeader(script);
  editor.setElements(script.elements);
  session.adoptLoadedDocument(editor.getDocument());
  sceneKey = "";
  showScriptWarnings(script.warnings);
  paint(editor.getDocument(), editor.view.state.selection.main.head);
  editor.setEditable(true);
  setFieldsEnabled(true);
  editor.focus();
}

function fillHeader(script: Script) {
  titleInput.value = script.title;
  creditInput.value = script.credit;
  authorInput.value = script.author;
  draftInput.value = script.draft;
  contactInput.value = script.contact;
  document.title = titled(script.title);
}

function titled(title: string): string {
  return title || "Scriptwriter";
}

function showScriptWarnings(warnings: readonly string[]) {
  if (warnings.length > 0) showWarning(warnings.join(" "));
  else clearWarnings();
}

function setFieldsEnabled(enabled: boolean) {
  for (const field of fields) field.disabled = !enabled;
}

async function exportFile(exporter: () => Promise<void>) {
  try {
    await exporter();
  } catch (error) {
    showWarning(message(error));
  }
}

function paint(document: DocumentSnapshot, cursor: number) {
  elementName.textContent = elementLabel(document, cursor);
  pageName.textContent = pageLabel(document, cursor);
  paintScenes(document, cursor);
  placeMarginLabel();
}

function paintScenes(document: DocumentSnapshot, cursor: number) {
  refreshOutline(derive(document).outline);
  markCurrentScene(cursor);
}

function refreshOutline(rows: readonly OutlineRow[]) {
  const key = rows.map(outlineToken).join("\n");
  if (key !== sceneKey) replaceOutline(rows, key);
}

function markCurrentScene(cursor: number) {
  for (const item of scenesEl.querySelectorAll<HTMLButtonElement>(".scene")) markScene(item, cursor);
}

function markScene(item: HTMLButtonElement, cursor: number) {
  if (sceneIsCurrent(item, cursor)) item.setAttribute("aria-current", "true");
  else item.removeAttribute("aria-current");
}

function sceneIsCurrent(item: HTMLButtonElement, cursor: number): boolean {
  const from = Number(item.dataset.from);
  return cursor >= from && beforeNextScene(cursor, nextRowFrom(item));
}

function beforeNextScene(cursor: number, next: number | null): boolean {
  return next === null || cursor < next;
}

function outlineToken(row: OutlineRow): string {
  return `${row.kind}\0${row.number ?? ""}\0${row.from}\0${row.text}`;
}

function replaceOutline(rows: readonly OutlineRow[], key: string) {
  sceneKey = key;
  scenesEl.replaceChildren(...rows.map(outlineButton));
}

function outlineButton(row: OutlineRow): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = outlineClass(row.kind);
  button.textContent = outlineLabel(row);
  button.dataset.from = String(row.from);
  button.addEventListener("click", () => editor.goto(row.from));
  return button;
}

function outlineClass(kind: string): string {
  return kind === "act" ? "scene outline-act" : "scene";
}

function outlineLabel(row: OutlineRow): string {
  return row.number === null ? row.text : `${row.number}  ${row.text}`;
}

function nextRowFrom(button: HTMLButtonElement): number | null {
  const next = button.nextElementSibling;
  if (!(next instanceof HTMLButtonElement)) return null;
  return finiteFrom(next.dataset.from);
}

function finiteFrom(value: string | undefined): number | null {
  const from = Number(value);
  return Number.isFinite(from) ? from : null;
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
