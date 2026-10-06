import { StateField, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { derive } from "../projections/derived";
import { documentOf, metadataChanged } from "./state";

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

  get estimatedHeight(): number {
    return 0;
  }
}

function buildDecorations(state: Parameters<typeof documentOf>[0]): DecorationSet {
  const screenplay = documentOf(state);
  const derived = derive(screenplay);
  const numbers = new Map(derived.scenes.map((scene) => [scene.from, scene.number]));
  const ranges: Range<Decoration>[] = [];
  for (const element of screenplay.elements) {
    const line = state.doc.lineAt(Math.min(element.from, state.doc.length));
    ranges.push(Decoration.line({ class: `el-${element.type}` }).range(line.from));
    const number = element.type === "scene" ? numbers.get(element.from) : undefined;
    if (number !== undefined) {
      ranges.push(
        Decoration.widget({ widget: new SceneNumber(String(number), element.from), side: -1 }).range(element.from),
      );
    }
  }
  for (const [index, source] of derived.pageStarts.entries()) {
    const at = Math.max(0, Math.min(source, state.doc.length));
    ranges.push(
      Decoration.widget({ widget: new PageRule(String(index + 2)), side: -1, block: true }).range(
        state.doc.lineAt(at).from,
      ),
    );
  }
  return Decoration.set(ranges, true);
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
