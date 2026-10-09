// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { elementsDocument, normalizeElements, type ScriptElement } from "../domain/document";
import { PageRule, SceneNumber, scriptDecorations } from "./decorations";
import { metadataExtensions, replaceLineTypes } from "./state";

function stateFor(elements: readonly Omit<ScriptElement, "blanksBefore">[]) {
  const document = elementsDocument(normalizeElements(elements));
  return EditorState.create({
    doc: document.text,
    extensions: [metadataExtensions(document), scriptDecorations],
  });
}

function specs(state: EditorState) {
  const found: { from: number; spec: { widget?: WidgetType; side?: number; block?: boolean } }[] = [];
  const cursor = state.field(scriptDecorations).iter();
  while (cursor.value) {
    found.push({ from: cursor.from, spec: cursor.value.spec });
    cursor.next();
  }
  return found;
}

describe("screenplay decorations", () => {
  it("distinguishes scene numbers and page rules by their own fields", () => {
    const scene = new SceneNumber("1", 4);
    expect(scene.eq(scene)).toBe(true);
    expect(scene.eq(new SceneNumber("2", 4))).toBe(false);
    expect(scene.eq(new SceneNumber("1", 9))).toBe(false);
    expect(scene.eq(new PageRule("1"))).toBe(false);
    const rule = new PageRule("2");
    expect(rule.eq(new PageRule("2"))).toBe(true);
    expect(rule.eq(new PageRule("3"))).toBe(false);
    expect(rule.eq(new SceneNumber("2", 0))).toBe(false);
    expect(rule.estimatedHeight).toBe(0);
    expect(scene.ignoreEvent()).toBe(true);
    expect(rule.ignoreEvent()).toBe(true);
  });

  it("numbers the scene and sorts a later page rule ahead of the lines below it", () => {
    const state = stateFor([
      { type: "scene", text: "ROOM" },
      ...Array.from({ length: 60 }, (_, index) => ({ type: "action" as const, text: `Line ${index}` })),
    ]);
    const widgets = specs(state).filter((range) => range.spec.widget);
    const scene = widgets.find((range) => range.spec.widget instanceof SceneNumber);
    const page = widgets.find((range) => range.spec.widget instanceof PageRule);
    expect(scene?.spec.widget).toBeInstanceOf(SceneNumber);
    expect(scene?.spec.side).toBe(-1);
    expect((scene?.spec.widget as SceneNumber).toDOM().textContent).toContain("1");
    expect(page?.spec.widget).toBeInstanceOf(PageRule);
    expect(page?.spec.side).toBe(-1);
    expect(page?.spec.block).toBe(true);
    expect((page?.spec.widget as PageRule).toDOM().textContent).toBe("2");
    const actionOnly = stateFor([{ type: "action", text: "Hello" }]);
    expect(specs(actionOnly).some((range) => range.spec.widget instanceof SceneNumber)).toBe(false);
  });

  it("keeps the element class on the text after a page rule", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const documentSnapshot = elementsDocument(normalizeElements([
      { type: "dialogue", text: "word ".repeat(400).trim() },
    ]));
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: documentSnapshot.text,
        extensions: [metadataExtensions(documentSnapshot), scriptDecorations],
      }),
    });
    const rules = [...view.contentDOM.querySelectorAll(".page-rule")];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const next = rule.nextElementSibling;
      expect(next?.classList.contains("cm-line")).toBe(true);
      expect(next?.querySelector(".el-dialogue")).toBeTruthy();
    }
    view.destroy();
    parent.remove();
  });

  it("rebuilds after a line-type change and keeps decorations for a selection change", () => {
    const state = stateFor([{ type: "action", text: "Hello" }]);
    const typed = state.update({ effects: replaceLineTypes.of(["dialogue"]) });
    expect(classNames(typed.state)).toContain("el-dialogue");
    const selected = state.update({ selection: EditorSelection.cursor(1) });
    expect(selected.state.field(scriptDecorations)).toBe(state.field(scriptDecorations));
  });
});

function classNames(state: EditorState): string[] {
  const names: string[] = [];
  const cursor = state.field(scriptDecorations).iter();
  while (cursor.value) {
    const spec = cursor.value.spec as { class?: string };
    if (spec.class) names.push(spec.class);
    cursor.next();
  }
  return names;
}
