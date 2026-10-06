import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ScriptSession } from "../application/session";
import { elementAt, type DocumentSnapshot } from "../domain/document";
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
  const element = elementAt(editor.getDocument(), editor.view.state.selection.main.head);
  const type = element?.type ?? "";
  for (const item of formatMenu.querySelectorAll("button")) {
    if (!(item instanceof HTMLButtonElement)) continue;
    const current = type !== "" && item.dataset.element === type;
    item.classList.toggle("is-current", current);
    if (current) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  }
}

function inScriptMargin(event: MouseEvent): boolean {
  const box = editor.view.contentDOM.getBoundingClientRect();
  return event.clientY >= box.top - 2 && event.clientY <= box.bottom + 2 &&
    (event.clientX < box.left - 1 || event.clientX > box.right + 1);
}

function marginPosition(event: MouseEvent): number | null {
  const line = [...editor.view.contentDOM.querySelectorAll(".cm-line")].find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return event.clientY >= rect.top - 1 && event.clientY <= rect.bottom + 1;
  });
  if (!(line instanceof HTMLElement)) return null;
  const box = editor.view.contentDOM.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
  const pos = editor.view.posAtCoords({ x, y: event.clientY }, false);
  if (pos === null) return null;
  const found = editor.view.domAtPos(Math.min(Math.max(pos, 0), editor.view.state.doc.length));
  const element = found.node instanceof Element ? found.node : found.node.parentElement;
  return element?.closest(".cm-line") === line ? pos : null;
}

async function chooseScript() {
  editor.setEditable(false);
  setFieldsEnabled(false);
  try {
    if (await session.chooseScript()) showLoaded();
  } catch (error) {
    showWarning(message(error));
  } finally {
    if (session.state.script) {
      editor.setEditable(true);
      setFieldsEnabled(true);
    }
  }
}

function showLoaded() {
  const { script, document: loaded } = session.state;
  if (!script || !loaded) return;
  titleInput.value = script.title;
  creditInput.value = script.credit;
  authorInput.value = script.author;
  draftInput.value = script.draft;
  contactInput.value = script.contact;
  document.title = script.title || "Scriptwriter";
  editor.setElements(script.elements);
  session.adoptLoadedDocument(editor.getDocument());
  sceneKey = "";
  if (script.warnings.length > 0) showWarning(script.warnings.join(" "));
  else clearWarnings();
  paint(editor.getDocument(), editor.view.state.selection.main.head);
  editor.setEditable(true);
  setFieldsEnabled(true);
  editor.focus();
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
  const rows = derive(document).outline;
  const key = rows.map(outlineToken).join("\n");
  if (key !== sceneKey) replaceOutline(rows, key);
  for (const item of scenesEl.querySelectorAll<HTMLButtonElement>(".scene")) {
    const from = Number(item.dataset.from);
    const next = nextRowFrom(item);
    const current = cursor >= from && (next === null || cursor < next);
    if (current) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  }
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
  button.className = row.kind === "act" ? "scene outline-act" : "scene";
  button.textContent = row.number === null ? row.text : `${row.number}  ${row.text}`;
  button.dataset.from = String(row.from);
  button.addEventListener("click", () => editor.goto(row.from));
  return button;
}

function nextRowFrom(button: HTMLButtonElement): number | null {
  const next = button.nextElementSibling;
  if (!(next instanceof HTMLButtonElement)) return null;
  const from = Number(next.dataset.from);
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
