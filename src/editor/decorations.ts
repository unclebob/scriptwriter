import { EditorState, StateField, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, layer, type DecorationSet, type LayerMarker, type ViewUpdate } from "@codemirror/view";
import { derive } from "../projections/derived";
import { documentOf, metadataChanged } from "./state";

export class SceneNumber extends WidgetType {
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

/** A page rule drawn over the sheet. It is not part of the text. */
export class PageRule implements LayerMarker {
  constructor(
    readonly label: string,
    readonly top: number,
    readonly left: number,
    readonly width: number,
    readonly inBlank: boolean,
  ) {}

  eq(other: LayerMarker): boolean {
    if (!(other instanceof PageRule)) return false;
    return ruleKey(this) === ruleKey(other);
  }

  draw(): HTMLElement {
    const rule = document.createElement("div");
    fillRule(rule, this);
    return rule;
  }

  update(dom: HTMLElement, old: LayerMarker): boolean {
    if (!(old instanceof PageRule)) return false;
    fillRule(dom, this);
    return true;
  }
}

function fillRule(rule: HTMLElement, marker: PageRule): void {
  rule.className = ruleClass(marker.inBlank);
  rule.replaceChildren(pageNumber(marker.label));
  placeRule(rule, marker);
}

function pageNumber(label: string): HTMLElement {
  const number = document.createElement("span");
  number.className = "page-number";
  number.textContent = label;
  return number;
}

function ruleKey(rule: PageRule): string {
  return [rule.label, rule.top, rule.left, rule.width, rule.inBlank].join(":");
}

function ruleClass(inBlank: boolean): string {
  if (inBlank) return "page-rule page-rule-after-blank";
  return "page-rule";
}

function placeRule(rule: HTMLElement, marker: PageRule): void {
  rule.style.left = `${marker.left}px`;
  rule.style.top = `${marker.top}px`;
  rule.style.width = `${marker.width}px`;
}

function buildDecorations(state: EditorState): DecorationSet {
  const screenplay = documentOf(state);
  const derived = derive(screenplay);
  const numbers = new Map(derived.scenes.map((scene) => [scene.from, scene.number]));
  const ranges: Range<Decoration>[] = [];
  for (const element of screenplay.elements) {
    const line = state.doc.lineAt(Math.min(element.from, state.doc.length));
    ranges.push(Decoration.line({ class: `el-${element.type}` }).range(line.from));
    markText(ranges, element.type, element.from, element.to);
    const number = element.type === "scene" ? numbers.get(element.from) : undefined;
    if (number !== undefined) {
      const sceneSide = -1;
      ranges.push(
        Decoration.widget({
          widget: new SceneNumber(String(number), element.from),
          side: sceneSide,
        }).range(element.from),
      );
    }
  }
  const sort = true;
  return Decoration.set(ranges, sort);
}

/** Source offsets where a page rule is drawn. The rule is an overlay, not a break in the line. */
export function pageBreakOffsets(state: EditorState): number[] {
  const length = state.doc.length;
  return derive(documentOf(state)).pageStarts.map((source) => Math.min(source, length));
}

export const pageRuleLayer = layer({
  above: true,
  class: "page-rules",
  update: pageRulesMoved,
  markers: pageRuleMarkers,
});

function pageRulesMoved(update: ViewUpdate): boolean {
  if (update.docChanged) return true;
  return update.transactions.some(metadataChanged);
}

function pageRuleMarkers(view: EditorView): readonly LayerMarker[] {
  return pageBreakOffsets(view.state).flatMap((at, index) => placedRule(view, at, index));
}

function placedRule(view: EditorView, at: number, index: number): PageRule[] {
  const coords = view.coordsAtPos(at);
  if (!hasBox(coords)) return [];
  const origin = scrollOrigin(view);
  const content = view.contentDOM.getBoundingClientRect();
  return [new PageRule(String(index + 2), coords.top - origin.top, content.left - origin.left, content.width, blankBefore(view, at))];
}

function hasBox(coords: { top: number; bottom: number } | null): coords is { top: number; bottom: number } {
  return coords !== null && coords.bottom > coords.top;
}

function scrollOrigin(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function blankBefore(view: EditorView, at: number): boolean {
  const line = view.state.doc.lineAt(at);
  if (line.from !== at) return false;
  return previousLineBlank(view, line.number);
}

function previousLineBlank(view: EditorView, number: number): boolean {
  if (number <= 1) return false;
  return view.state.doc.line(number - 1).text === "";
}

function markText(ranges: Range<Decoration>[], type: string, from: number, to: number) {
  if (from >= to) return;
  ranges.push(Decoration.mark({ class: `el-${type}` }).range(from, to));
}

export const scriptDecorations = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(decorations, transaction: Transaction) {
    return transaction.docChanged || metadataChanged(transaction)
      ? buildDecorations(transaction.state)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
