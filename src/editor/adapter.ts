import { acceptCompletion, autocompletion, completionKeymap, completionStatus, startCompletion, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, tooltips, type Rect } from "@codemirror/view";
import {
  editorDocument,
  elementAt,
  snapshot,
  type DocumentSnapshot,
  type EditorDocument,
  type ScriptElement,
} from "../domain/document";
import { ELEMENT_KEY, ELEMENT_LABEL, isElementType, type ElementType } from "../domain/elements";
import {
  afterInput,
  backspace,
  deleteElements,
  deleteForward,
  elementSelection,
  enter,
  insertBefore as insertBeforeEdit,
  insertElements,
  insertPlainText,
  replaceMatches,
  selectedElements,
  setElement,
  shiftTab,
  structuralEdit,
  tab,
  type Edit,
} from "./commands";
import { pageAt } from "../projections/layout";
import { completions } from "../projections/completion";
import { derive } from "../projections/derived";
import { scriptDecorations } from "./decorations";
import {
  documentOf,
  lineTypesOf,
  metadataChanged,
  metadataExtensions,
  replaceLineTypes,
  revisionOf,
  sameLineTypes,
} from "./state";

export type EditorHooks = {
  onChange: (document: DocumentSnapshot) => void;
  onCursor: (document: DocumentSnapshot, cursor: number) => void;
};

export type ScriptEditor = {
  view: EditorView;
  setElements: (elements: readonly ScriptElement[]) => void;
  getDocument: () => DocumentSnapshot;
  focus: () => void;
  setEditable: (editable: boolean) => void;
  goto: (pos: number) => void;
  insertBefore: (pos: number) => void;
};

export function createEditor(
  parent: HTMLElement,
  elements: readonly ScriptElement[],
  hooks: EditorHooks,
): ScriptEditor {
  const view = new EditorView({
    parent,
    state: stateFor(editorDocument(elements), parent.ownerDocument),
    dispatch: (transaction) => dispatchTo(view, hooks, transaction),
  });
  return {
    view,
    setElements(next) {
      view.setState(stateFor(editorDocument(next), view.dom.ownerDocument));
      hooks.onCursor(documentOf(view.state), view.state.selection.main.head);
    },
    getDocument: () => documentOf(view.state),
    focus: () => view.focus(),
    setEditable(editable) {
      view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(editable)) });
    },
    goto(pos) {
      const clipped = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({ selection: EditorSelection.cursor(clipped), scrollIntoView: true });
      view.focus();
    },
    insertBefore(pos) {
      apply(view, insertBeforeEdit(documentOf(view.state), pos));
      view.focus();
    },
  };
}

function dispatchTo(view: EditorView, hooks: EditorHooks, transaction: Transaction) {
  view.update([transaction]);
  const document = documentOf(view.state);
  const typesChanged = metadataChanged(transaction);
  if (transaction.docChanged || typesChanged) hooks.onChange(document);
  if (transaction.docChanged || typesChanged || transaction.selection !== null) {
    hooks.onCursor(document, view.state.selection.main.head);
  }
}

function stateFor(document: EditorDocument, host: globalThis.Document): EditorState {
  const anchor = openingCursor(document);
  const editable = true;
  const activateOnTyping = true;
  const completionKeys = false;
  const body: HTMLElement | null = host.body;
  const tooltipParent = body === null ? undefined : body;
  return EditorState.create({
    doc: document.text,
    selection: { anchor },
    extensions: [
      ...metadataExtensions(document),
      editableCompartment.of(EditorView.editable.of(editable)),
      history(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      EditorView.domEventHandlers({ copy: copyElements, paste: pasteElements }),
      autocompletion({ override: [completeSource], activateOnTyping, defaultKeymap: completionKeys }),
      tooltips({ parent: tooltipParent, tooltipSpace: completionTooltipSpace }),
      scriptTheme,
      scriptDecorations,
      normalizeInput,
      Prec.highest(
        keymap.of([
          { key: "Enter", run: onEnter },
          ...completionKeymap.filter((binding) => binding.key !== "Enter"),
          { key: "Tab", run: onTab },
          { key: "Shift-Tab", run: onShiftTab },
          { key: "Backspace", run: onBackspace },
          { key: "Delete", run: onDelete },
          { key: "Ctrl-d", run: onDelete },
          { key: "Mod-Delete", mac: "Alt-Delete", run: onDelete },
          ...ELEMENT_KEY.map((type, index) => ({ key: `Mod-${index + 1}`, run: setType(type) })),
        ]),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    ],
  });
}

const scriptTheme = EditorView.theme({
  "&": { height: "auto", background: "transparent" },
  ".cm-scroller": {
    overflow: "visible",
    height: "auto",
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: "12pt",
    lineHeight: "12pt",
  },
  ".cm-content": { padding: "0", caretColor: "#111" },
  ".cm-line": { padding: "0", minHeight: "12pt", position: "relative" },
  ".cm-line.el-act": { textAlign: "center" },
  ".cm-line.el-character": { paddingLeft: "2.2in" },
  ".cm-line.el-dialogue": { paddingLeft: "1in", paddingRight: "1.5in" },
  ".cm-line.el-parenthetical": { paddingLeft: "1.6in", paddingRight: "1.9in" },
  ".cm-line.el-transition": { textAlign: "right" },
  ".cm-gutters": { display: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-tooltip.cm-tooltip-autocomplete": { overflow: "hidden" },
});

/** The rectangle the completion menu may occupy: the window, and no further than the page stage. */
export function completionBounds(windowBox: Rect, stageBox: Rect | null): Rect {
  const limit = stageBox === null ? windowBox : stageBox;
  return {
    top: Math.max(windowBox.top, limit.top),
    left: Math.max(windowBox.left, limit.left),
    bottom: Math.min(windowBox.bottom, limit.bottom),
    right: Math.min(windowBox.right, limit.right),
  };
}

export function completionTooltipSpace(view: EditorView): Rect {
  const root = view.dom.ownerDocument.documentElement;
  const top = 0;
  const left = 0;
  const windowBox = { top, left, bottom: root.clientHeight, right: root.clientWidth };
  const stage = stageRect(view.dom.closest(".stage"));
  const bounds = completionBounds(windowBox, stage);
  const pad = 4;
  const paddedTop = bounds.top + pad;
  const paddedLeft = bounds.left + pad;
  const paddedBottom = bounds.bottom - pad;
  const paddedRight = bounds.right - pad;
  return { top: paddedTop, left: paddedLeft, bottom: paddedBottom, right: paddedRight };
}

function stageRect(stage: Element | null): Rect | null {
  if (!stage) return null;
  const box = stage.getBoundingClientRect();
  return { top: box.top, left: box.left, bottom: box.bottom, right: box.right };
}

function openingCursor(document: EditorDocument): number {
  const first = snapshot(document).elements[0];
  return first.type === "parenthetical" ? Math.min(first.from + 1, first.to) : first.from;
}

const normalizeInput = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return snapSelection(transaction);
  const event = transaction.annotation(Transaction.userEvent) ?? "";
  if (event.includes("structure.skip") || event.includes("compose")) return transaction;
  const change = singleChange(transaction);
  const before = documentOf(transaction.startState);
  if (event.includes("input.replace")) {
    const next = replaceMatches(before, textChanges(transaction), transaction.newSelection.main.head);
    return next ? editTransaction(transaction, next) : [];
  }
  if (change && event.includes("input") && change.inserted.includes("\n")) {
    const next = insertPlainText(before, change.from, change.to, change.inserted);
    return next ? editTransaction(transaction, next) : [];
  }
  if (change && event.includes("delete") && change.inserted === "" && change.from !== change.to) {
    const next = deleteElements(before, change.from, change.to);
    if (next) return editTransaction(transaction, next);
  }
  if ((event.includes("input") || event.includes("delete")) && editsStructure(transaction, before)) return [];
  const proposed = snapshot(
    { text: transaction.newDoc.toString(), lineTypes: before.lineTypes },
    before.revision + 1,
  );
  const next = afterInput(proposed, transaction.newSelection.main.head);
  if (sameDocument(next.document, proposed) && next.cursor === transaction.newSelection.main.head) {
    return snapSelection(transaction);
  }
  return editTransaction(transaction, next, typingEvent(event));
});

function snapSelection(transaction: Transaction): Transaction {
  const selection = transaction.newSelection.main;
  if (selection.empty) return transaction;
  const revision = revisionOf(transaction.startState);
  const document = snapshot(
    { text: transaction.newDoc.toString(), lineTypes: lineTypesOf(transaction.startState) },
    revision,
  );
  const span = elementSelection(document, selection.anchor, selection.head);
  if (!span) return transaction;
  const refilter = false;
  const scrollIntoView = true;
  return transaction.startState.update({
    changes: transaction.changes,
    selection: span,
    filter: refilter,
    scrollIntoView,
  });
}

const editableCompartment = new Compartment();

function textChanges(transaction: Transaction): { from: number; to: number; inserted: string }[] {
  const changes: { from: number; to: number; inserted: string }[] = [];
  transaction.changes.iterChanges((from, to, _fromNew, _toNew, text) => {
    changes.push({ from, to, inserted: text.toString() });
  });
  return changes;
}

function singleChange(transaction: Transaction): { from: number; to: number; inserted: string } | null {
  let found: { from: number; to: number; inserted: string } | null = null;
  let count = 0;
  transaction.changes.iterChanges((from, to, _fromNew, _toNew, text) => {
    count += 1;
    found = { from, to, inserted: text.toString() };
  });
  return count === 1 ? found : null;
}

function editTransaction(transaction: Transaction, next: Edit, typing?: boolean) {
  const unmarked = false;
  const markTyping = typing === undefined ? unmarked : typing;
  const origin = 0;
  const cursor = Math.max(origin, Math.min(next.cursor, next.document.text.length));
  const scrollIntoView = true;
  const eventName = markTyping ? "input.type" : "structure.skip";
  const replaceFrom = 0;
  return {
    changes: { from: replaceFrom, to: transaction.startState.doc.length, insert: next.document.text },
    selection: { anchor: cursor },
    effects: replaceLineTypes.of(next.document.lineTypes),
    annotations: Transaction.userEvent.of(eventName),
    scrollIntoView,
  };
}

function typingEvent(event: string): boolean {
  return event === "input.type" || event.startsWith("input.type.");
}

const completeSource: CompletionSource = (context) => {
  const found = completions(documentOf(context.state), context.pos);
  return found
    ? { from: found.from, to: found.to, options: found.options.map((label) => ({ label })) }
    : null;
};

function onEnter(view: EditorView): boolean {
  if (completionStatus(view.state) === "active" && acceptCompletion(view)) {
    const document = documentOf(view.state);
    const cursor = view.state.selection.main.head;
    if (elementAt(document, cursor)?.type === "character") apply(view, enter(document, cursor));
    offer(view);
    return true;
  }
  apply(view, enter(documentOf(view.state), view.state.selection.main.head));
  offer(view);
  return true;
}

function onTab(view: EditorView): boolean {
  if (completionStatus(view.state) === "active") {
    acceptCompletion(view);
    offer(view);
    return true;
  }
  apply(view, tab(documentOf(view.state), view.state.selection.main.head));
  offer(view);
  return true;
}

function onShiftTab(view: EditorView): boolean {
  apply(view, shiftTab(documentOf(view.state), view.state.selection.main.head));
  return true;
}

function onBackspace(view: EditorView): boolean {
  if (coveredSelection(view)) return removeCovered(view);
  return applyEdit(view, backspace(documentOf(view.state), view.state.selection.main.head));
}

function onDelete(view: EditorView): boolean {
  if (coveredSelection(view)) return removeCovered(view);
  return applyEdit(view, deleteForward(documentOf(view.state), view.state.selection.main.head));
}

function coveredSelection(view: EditorView): boolean {
  return !view.state.selection.main.empty;
}

function applyEdit(view: EditorView, next: Edit | null): boolean {
  if (!next) return false;
  apply(view, next);
  return true;
}

function removeCovered(view: EditorView): boolean {
  const document = documentOf(view.state);
  const selection = view.state.selection.main;
  const next = deleteElements(document, selection.from, selection.to);
  if (next) {
    apply(view, next);
    return true;
  }
  return structuralEdit(document, selection.from, selection.to);
}

function editsStructure(transaction: Transaction, document: DocumentSnapshot): boolean {
  let blocked = false;
  transaction.changes.iterChanges((from, to) => {
    if (structuralEdit(document, from, to)) blocked = true;
  });
  return blocked;
}

function setType(type: ElementType) {
  return (view: EditorView): boolean => {
    apply(view, setElement(documentOf(view.state), view.state.selection.main.head, type));
    offer(view);
    return true;
  };
}

function apply(view: EditorView, next: Edit) {
  const current = documentOf(view.state);
  const cursor = Math.max(0, Math.min(next.cursor, next.document.text.length));
  if (sameDocument(current, next.document) && cursor === view.state.selection.main.head) return;
  const typesChanged = !sameLineTypes(current.lineTypes, next.document.lineTypes);
  const sameText = current.text === next.document.text;
  const insertFrom = 0;
  const changes = sameText ? undefined : { from: insertFrom, to: current.text.length, insert: next.document.text };
  const scrollIntoView = true;
  view.dispatch({
    changes,
    selection: { anchor: cursor },
    effects: typesChanged ? replaceLineTypes.of(next.document.lineTypes) : undefined,
    annotations: Transaction.userEvent.of("structure.skip"),
    scrollIntoView,
  });
}

function sameDocument(left: EditorDocument, right: EditorDocument): boolean {
  return left.text === right.text && sameLineTypes(left.lineTypes, right.lineTypes);
}

function offer(view: EditorView) {
  const found = completions(documentOf(view.state), view.state.selection.main.head);
  const choices = found ? found.options.length : 0;
  if (choices > 0) startCompletion(view);
}

function copyElements(event: ClipboardEvent, view: EditorView): boolean {
  if (!writeCopy(event, view)) return false;
  return true;
}

function writeCopy(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData;
  const selection = view.state.selection.main;
  if (!copyable(selection, data)) return false;
  return storeElements(data, documentOf(view.state), selection.from, selection.to);
}

function copyable(selection: { empty: boolean }, data: DataTransfer | null): data is DataTransfer {
  return !selection.empty && data !== null;
}

function storeElements(data: DataTransfer, document: DocumentSnapshot, from: number, to: number): boolean {
  const elements = selectedElements(document, from, to);
  if (elements.length < 2) return false;
  data.setData("text/plain", document.text.slice(from, to));
  data.setData(ELEMENT_CLIPBOARD, JSON.stringify(elements));
  return true;
}

function pasteElements(event: ClipboardEvent, view: EditorView): boolean {
  const next = pastedEdit(event, view);
  if (!next) return false;
  apply(view, next);
  return true;
}

function pastedEdit(event: ClipboardEvent, view: EditorView): Edit | null {
  const data = event.clipboardData;
  if (!data) return null;
  const selection = view.state.selection.main;
  const document = documentOf(view.state);
  return pastedElements(document, selection.from, selection.to, data);
}

function pastedElements(document: DocumentSnapshot, from: number, to: number, data: DataTransfer): Edit | null {
  const structured = parseClipboardElements(data.getData(ELEMENT_CLIPBOARD));
  if (structured) return insertElements(document, from, to, structured);
  return insertPlainText(document, from, to, data.getData("text/plain"));
}

const ELEMENT_CLIPBOARD = "application/x-scriptwriter-elements+json";

function parseClipboardElements(encoded: string): ScriptElement[] | null {
  if (!encoded) return null;
  const value = clipboardJson(encoded);
  if (!Array.isArray(value)) return null;
  return clipboardList(value);
}

function clipboardJson(encoded: string): unknown {
  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function clipboardList(value: unknown[]): ScriptElement[] | null {
  const elements: ScriptElement[] = [];
  for (const item of value) {
    const element = clipboardElement(item);
    if (!element) return null;
    elements.push(element);
  }
  return elements;
}

function clipboardElement(item: unknown): ScriptElement | null {
  if (!clipboardRecord(item)) return null;
  return clipboardFields(item);
}

function clipboardRecord(item: unknown): item is Record<string, unknown> {
  return typeof item === "object" && item !== null;
}

function clipboardFields(item: Record<string, unknown>): ScriptElement | null {
  if (!clipboardType(item.type) || !clipboardText(item.text)) return null;
  return { type: item.type, text: item.text, blanksBefore: item.blanksBefore === 0 ? 0 : 1 };
}

function clipboardType(value: unknown): value is ElementType {
  return typeof value === "string" && isElementType(value);
}

function clipboardText(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\n");
}

export function findInScript(editor: ScriptEditor) {
  openSearchPanel(editor.view);
  editor.focus();
}

export function useElement(editor: ScriptEditor, type: ElementType) {
  apply(editor.view, setElement(editor.getDocument(), editor.view.state.selection.main.head, type));
  offer(editor.view);
  editor.focus();
}

export function elementLabel(document: DocumentSnapshot, cursor: number): string {
  return elementName(document, cursor, "Blank");
}

export function marginText(document: DocumentSnapshot, cursor: number): string {
  return elementName(document, cursor, "");
}

function elementName(document: DocumentSnapshot, cursor: number, empty: string): string {
  const element = elementAt(document, cursor);
  return element ? ELEMENT_LABEL[element.type] : empty;
}

export function pageLabel(document: DocumentSnapshot, cursor: number): string {
  const at = pageAt(derive(document).pages, cursor);
  return `Page ${at.page} of ${at.pages}`;
}
