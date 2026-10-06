import { acceptCompletion, autocompletion, completionStatus, startCompletion, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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
    state: stateFor(editorDocument(elements)),
    dispatch: (transaction) => dispatchTo(view, hooks, transaction),
  });
  return {
    view,
    setElements(next) {
      view.setState(stateFor(editorDocument(next)));
      hooks.onCursor(documentOf(view.state), view.state.selection.main.head);
    },
    getDocument: () => documentOf(view.state),
    focus: () => view.focus(),
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

function stateFor(document: EditorDocument): EditorState {
  const anchor = openingCursor(document);
  return EditorState.create({
    doc: document.text,
    selection: { anchor },
    extensions: [
      ...metadataExtensions(document),
      history(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      EditorView.domEventHandlers({ copy: copyElements, paste: pasteElements }),
      autocompletion({ override: [completeSource], activateOnTyping: true }),
      scriptTheme,
      scriptDecorations,
      normalizeInput,
      Prec.highest(
        keymap.of([
          { key: "Enter", run: onEnter },
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
});

function openingCursor(document: EditorDocument): number {
  const first = snapshot(document).elements[0];
  if (!first || first.from !== 0) return 0;
  return first.type === "parenthetical" ? Math.min(first.from + 1, first.to) : first.from;
}

const normalizeInput = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return snapSelection(transaction);
  const event = transaction.annotation(Transaction.userEvent) ?? "";
  if (event.includes("structure.skip") || event.includes("compose")) return transaction;
  const change = singleChange(transaction);
  const before = documentOf(transaction.startState);
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
  return editTransaction(transaction, next);
});

function snapSelection(transaction: Transaction): Transaction {
  const selection = transaction.newSelection.main;
  if (selection.empty) return transaction;
  const document = snapshot(
    { text: transaction.newDoc.toString(), lineTypes: lineTypesOf(transaction.startState) },
    revisionOf(transaction.startState) + Number(transaction.docChanged),
  );
  const span = elementSelection(document, selection.anchor, selection.head);
  if (!span) return transaction;
  return transaction.startState.update({
    changes: transaction.changes,
    selection: span,
    filter: false,
    scrollIntoView: true,
  });
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

function editTransaction(transaction: Transaction, next: Edit) {
  const cursor = Math.max(0, Math.min(next.cursor, next.document.text.length));
  return {
    changes: { from: 0, to: transaction.startState.doc.length, insert: next.document.text },
    selection: { anchor: cursor },
    effects: replaceLineTypes.of(next.document.lineTypes),
    annotations: Transaction.userEvent.of("structure.skip"),
    scrollIntoView: true,
  };
}

const completeSource: CompletionSource = (context) => {
  const found = completions(documentOf(context.state), context.pos);
  return found
    ? { from: found.from, to: found.to, options: found.options.map((label) => ({ label })) }
    : null;
};

function onEnter(view: EditorView): boolean {
  if (completionStatus(view.state) === "active") {
    acceptCompletion(view);
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
  const selection = view.state.selection.main;
  if (!selection.empty) return removeCovered(view);
  const next = backspace(documentOf(view.state), selection.head);
  if (!next) return false;
  apply(view, next);
  return true;
}

function onDelete(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return removeCovered(view);
  const next = deleteForward(documentOf(view.state), selection.head);
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
  view.dispatch({
    changes: current.text === next.document.text ? undefined : { from: 0, to: current.text.length, insert: next.document.text },
    selection: { anchor: cursor },
    effects: typesChanged ? replaceLineTypes.of(next.document.lineTypes) : undefined,
    annotations: Transaction.userEvent.of("structure.skip"),
    scrollIntoView: true,
  });
}

function sameDocument(left: EditorDocument, right: EditorDocument): boolean {
  return left.text === right.text && sameLineTypes(left.lineTypes, right.lineTypes);
}

function offer(view: EditorView) {
  const found = completions(documentOf(view.state), view.state.selection.main.head);
  if (found && found.options.length > 0) startCompletion(view);
}

function copyElements(event: ClipboardEvent, view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.empty || !event.clipboardData) return false;
  const document = documentOf(view.state);
  const elements = selectedElements(document, selection.from, selection.to);
  if (elements.length < 2) return false;
  event.clipboardData.setData("text/plain", document.text.slice(selection.from, selection.to));
  event.clipboardData.setData("application/x-scriptwriter-elements+json", JSON.stringify(elements));
  event.preventDefault();
  return true;
}

function pasteElements(event: ClipboardEvent, view: EditorView): boolean {
  if (!event.clipboardData) return false;
  const selection = view.state.selection.main;
  const document = documentOf(view.state);
  const encoded = event.clipboardData.getData("application/x-scriptwriter-elements+json");
  const structured = parseClipboardElements(encoded);
  const next = structured
    ? insertElements(document, selection.from, selection.to, structured)
    : insertPlainText(document, selection.from, selection.to, event.clipboardData.getData("text/plain"));
  if (!next) return false;
  event.preventDefault();
  apply(view, next);
  return true;
}

function parseClipboardElements(encoded: string): ScriptElement[] | null {
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    if (!Array.isArray(value)) return null;
    const elements: ScriptElement[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) return null;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.type !== "string" || !isElementType(candidate.type)) return null;
      if (typeof candidate.text !== "string" || candidate.text.includes("\n")) return null;
      elements.push({
        type: candidate.type,
        text: candidate.text,
        blanksBefore: candidate.blanksBefore === 0 ? 0 : 1,
      });
    }
    return elements;
  } catch {
    return null;
  }
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
