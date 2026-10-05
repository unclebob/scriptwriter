import { acceptCompletion, autocompletion, completionStatus, startCompletion, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState, Prec, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from "@codemirror/view";
import { afterInput, backspace, deleteElements, deleteForward, elementSelection, enter, insertBefore as insertBeforeEdit, insertElements, setElement, shiftTab, structuralEdit, tab } from "../internals/edit";
import {
  ELEMENT_KEY,
  ELEMENT_LABEL,
  elementAt,
  parseScript,
  type ElementType,
} from "../internals/fountain";
import { pageAt, pageStarts } from "../internals/layout";
import { sceneRows } from "../internals/scenes";
import { completions } from "../internals/smarttype";

export type EditorHooks = {
  onChange: (doc: string) => void;
  onCursor: (doc: string, cursor: number) => void;
};

export type ScriptEditor = {
  view: EditorView;
  setDoc: (doc: string) => void;
  getDoc: () => string;
  focus: () => void;
  goto: (pos: number) => void;
  insertBefore: (pos: number) => void;
};

class SceneNumber extends WidgetType {
  constructor(readonly label: string, readonly at: number) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof SceneNumber && other.label === this.label && other.at === this.at;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "scene-numbers";
    const left = document.createElement("span");
    left.className = "scene-number scene-number-left";
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = "insert-above";
    arrow.dataset.from = String(this.at);
    arrow.setAttribute("aria-label", "Insert above");
    arrow.textContent = "↑";
    left.append(arrow, document.createTextNode(this.label));
    const right = document.createElement("span");
    right.className = "scene-number scene-number-right";
    right.textContent = this.label;
    wrap.append(left, right);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class PageRule extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof PageRule && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const rule = document.createElement("div");
    rule.className = "page-rule";
    rule.textContent = this.label;
    return rule;
  }

  ignoreEvent(): boolean {
    return true;
  }

  /** The rule is a hairline. A guessed line of height would shift the pages. */
  get estimatedHeight(): number {
    return 0;
  }
}

export function createEditor(parent: HTMLElement, doc: string, hooks: EditorHooks): ScriptEditor {
  const view = new EditorView({
    parent,
    state: stateFor(doc),
    dispatch: (transaction) => {
      view.update([transaction]);
      if (transaction.docChanged) hooks.onChange(view.state.doc.toString());
      if (transaction.docChanged || transaction.selection) hooks.onCursor(view.state.doc.toString(), view.state.selection.main.head);
    },
  });
  return {
    view,
    setDoc(next) {
      view.setState(stateFor(next));
      hooks.onCursor(next, view.state.selection.main.head);
    },
    getDoc: () => view.state.doc.toString(),
    focus: () => view.focus(),
    goto(pos) {
      const clipped = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({ selection: EditorSelection.cursor(clipped), scrollIntoView: true });
      view.focus();
    },
    insertBefore(pos) {
      apply(view, insertBeforeEdit(view.state.doc.toString(), pos));
      view.focus();
    },
  };
}

function stateFor(doc: string): EditorState {
  const first = elementAt(doc, 0);
  const anchor = first && first.from === 0 ? Math.min(first.from + first.marker, doc.length) : 0;
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      history(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      autocompletion({ override: [completeSource], activateOnTyping: true }),
      scriptTheme,
      scriptDecorations,
      markerAtoms,
      normalizeInput,
      Prec.highest(keymap.of([
        { key: "Enter", run: onEnter },
        { key: "Tab", run: onTab },
        { key: "Shift-Tab", run: onShiftTab },
        { key: "Backspace", run: onBackspace },
        { key: "Delete", run: onDelete },
        { key: "Ctrl-d", run: onDelete },
        { key: "Mod-Delete", mac: "Alt-Delete", run: onDelete },
        ...ELEMENT_KEY.map((type, index) => ({ key: `Mod-${index + 1}`, run: setType(type) })),
      ])),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    ],
  });
}

const scriptTheme = EditorView.theme({
  "&": { height: "auto", background: "transparent" },
  // The stage scrolls the whole script. A fixed scroller would clip page 2 and
  // send scroll-into-view back to the arrow at the top of page 1.
  ".cm-scroller": { overflow: "visible", height: "auto", fontFamily: '"Courier New", Courier, monospace', fontSize: "12pt", lineHeight: "12pt" },
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

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const numbers = new Map(sceneRows(doc).map((scene) => [scene.from, scene.number]));
  const ranges: Range<Decoration>[] = [];
  for (const element of parseScript(doc)) {
    const line = state.doc.lineAt(Math.min(element.from, state.doc.length));
    ranges.push(Decoration.line({ class: `el-${element.type}` }).range(line.from));
    if (element.marker > 0) {
      ranges.push(Decoration.replace({}).range(element.from, element.from + element.marker));
    }
    const number = element.type === "scene" ? numbers.get(element.from) : undefined;
    if (number) {
      ranges.push(Decoration.widget({ widget: new SceneNumber(String(number), element.from), side: -1 }).range(element.from + element.marker));
    }
  }
  // A block widget has to sit on a line boundary. A page that starts mid-element marks that line.
  for (const [index, source] of pageStarts(doc).entries()) {
    const at = Math.max(0, Math.min(source, state.doc.length));
    const line = state.doc.lineAt(at);
    ranges.push(Decoration.widget({ widget: new PageRule(String(index + 2)), side: -1, block: true }).range(line.from));
  }
  return Decoration.set(ranges, true);
}

// Block widgets have to come from a state field. A view plugin rejects them.
const scriptDecorations = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(decorations, transaction) {
    return transaction.docChanged ? buildDecorations(transaction.state) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const markerAtoms = EditorView.atomicRanges.of((view) => {
  const ranges = [];
  for (const element of parseScript(view.state.doc.toString())) {
    if (element.marker > 0) ranges.push(Decoration.replace({}).range(element.from, element.from + element.marker));
  }
  return Decoration.set(ranges, true);
});

const normalizeInput = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return spanSelection(transaction);
  const event = transaction.annotation(Transaction.userEvent) ?? "";
  if (event.includes("normalize.skip") || event.includes("compose")) return transaction;
  const change = singleChange(transaction);
  const doc = transaction.startState.doc.toString();
  if (change && event.includes("input") && change.inserted.includes("\n")) {
    const next = insertElements(doc, change.from, change.to, change.inserted);
    if (!next || next.doc === doc) return [];
    return editTransaction(transaction, next);
  }
  if (change && event.includes("delete") && change.inserted === "" && change.from !== change.to) {
    const next = deleteElements(doc, change.from, change.to);
    if (next) return editTransaction(transaction, next);
  }
  if ((event.includes("input") || event.includes("delete")) && editsStructure(transaction)) return [];
  const proposed = transaction.newDoc.toString();
  const cursor = transaction.newSelection.main.head;
  const next = afterInput(proposed, cursor);
  if (next.doc === proposed && next.cursor === cursor) return spanSelection(transaction);
  return {
    changes: { from: 0, to: transaction.startState.doc.length, insert: next.doc },
    selection: { anchor: Math.max(0, Math.min(next.cursor, next.doc.length)) },
    annotations: Transaction.userEvent.of("normalize.skip"),
    scrollIntoView: true,
  };
});

function spanSelection(transaction: Transaction): Transaction {
  const selection = transaction.newSelection.main;
  if (selection.empty) return transaction;
  const span = elementSelection(transaction.newDoc.toString(), selection.anchor, selection.head);
  if (!span) return transaction;
  return transaction.startState.update({
    changes: transaction.changes,
    selection: { anchor: span.anchor, head: span.head },
    filter: false,
    scrollIntoView: true,
  });
}

function singleChange(transaction: Transaction): { from: number; to: number; inserted: string } | null {
  let count = 0;
  let from = 0;
  let to = 0;
  let inserted = "";
  transaction.changes.iterChanges((start, end, _fromB, _toB, text) => {
    count += 1;
    from = start;
    to = end;
    inserted = text.toString();
  });
  if (count !== 1) return null;
  return { from, to, inserted };
}

function editTransaction(transaction: Transaction, next: { doc: string; cursor: number }) {
  const cursor = Math.max(0, Math.min(next.cursor, next.doc.length));
  return {
    changes: { from: 0, to: transaction.startState.doc.length, insert: next.doc },
    selection: { anchor: cursor },
    userEvent: "normalize.skip",
    scrollIntoView: true,
  };
}

const completeSource: CompletionSource = (context) => {
  const found = completions(context.state.doc.toString(), context.pos);
  if (!found) return null;
  return {
    from: found.from,
    to: found.to,
    options: found.options.map((label) => ({ label })),
  };
}

function onEnter(view: EditorView): boolean {
  if (completionStatus(view.state) === "active") {
    const element = elementAt(view.state.doc.toString(), view.state.selection.main.head);
    acceptCompletion(view);
    if (element?.type === "scene" || element?.type === "transition") {
      offer(view);
      return true;
    }
  }
  apply(view, enter(view.state.doc.toString(), view.state.selection.main.head));
  offer(view);
  return true;
}

function onTab(view: EditorView): boolean {
  if (completionStatus(view.state) === "active") {
    acceptCompletion(view);
    offer(view);
    return true;
  }
  apply(view, tab(view.state.doc.toString(), view.state.selection.main.head));
  offer(view);
  return true;
}

function onShiftTab(view: EditorView): boolean {
  apply(view, shiftTab(view.state.doc.toString(), view.state.selection.main.head));
  return true;
}

function onBackspace(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return removeCovered(view);
  const next = backspace(view.state.doc.toString(), selection.head);
  if (!next) return false;
  apply(view, next);
  return true;
}

function onDelete(view: EditorView): boolean {
  const doc = view.state.doc.toString();
  const selection = view.state.selection.main;
  if (!selection.empty) return removeCovered(view);
  const next = deleteForward(doc, selection.head);
  if (!next) return false;
  apply(view, next);
  return true;
}

function removeCovered(view: EditorView): boolean {
  const doc = view.state.doc.toString();
  const selection = view.state.selection.main;
  const next = deleteElements(doc, selection.from, selection.to);
  if (next) {
    apply(view, next);
    return true;
  }
  return structuralEdit(doc, selection.from, selection.to);
}

function editsStructure(transaction: Transaction): boolean {
  const doc = transaction.startState.doc.toString();
  let blocked = false;
  transaction.changes.iterChanges((from, to) => {
    if (structuralEdit(doc, from, to)) blocked = true;
  });
  return blocked;
}

function setType(type: ElementType) {
  return (view: EditorView): boolean => {
    apply(view, setElement(view.state.doc.toString(), view.state.selection.main.head, type));
    offer(view);
    return true;
  };
}

function apply(view: EditorView, next: { doc: string; cursor: number }) {
  const doc = view.state.doc.toString();
  const cursor = Math.max(0, Math.min(next.cursor, next.doc.length));
  if (next.doc === doc && cursor === view.state.selection.main.head) return;
  view.dispatch({
    changes: next.doc === doc ? undefined : { from: 0, to: doc.length, insert: next.doc },
    selection: { anchor: cursor },
    scrollIntoView: true,
  });
}

function offer(view: EditorView) {
  const found = completions(view.state.doc.toString(), view.state.selection.main.head);
  if (found && found.options.length > 0) startCompletion(view);
}

export function findInScript(editor: ScriptEditor) {
  openSearchPanel(editor.view);
  editor.focus();
}

export function useElement(editor: ScriptEditor, type: ElementType) {
  apply(editor.view, setElement(editor.getDoc(), editor.view.state.selection.main.head, type));
  offer(editor.view);
  editor.focus();
}

export function elementLabel(doc: string, cursor: number): string {
  const element = elementAt(doc, cursor);
  return element ? ELEMENT_LABEL[element.type] : "Blank";
}

/** The left-margin name. Blank lines are not labeled. */
export function marginText(doc: string, cursor: number): string {
  const element = elementAt(doc, cursor);
  return element ? ELEMENT_LABEL[element.type] : "";
}

export function pageLabel(doc: string, cursor: number): string {
  const at = pageAt(doc, cursor);
  return `Page ${at.page} of ${at.pages}`;
}
