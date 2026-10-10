// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, WidgetType, type LayerMarker } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { elementsDocument, normalizeElements, type ScriptElement } from "../domain/document";
import { PageRule, SceneNumber, pageBreakOffsets, pageRuleLayer, scriptDecorations } from "./decorations";
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
    expect(scene.eq(new PageRule("1", 0, 0, 0, false) as unknown as WidgetType)).toBe(false);
    const rule = new PageRule("2", 10, 0, 100, false);
    expect(rule.eq(new PageRule("2", 10, 0, 100, false))).toBe(true);
    expect(rule.eq(new PageRule("3", 10, 0, 100, false))).toBe(false);
    expect(rule.eq(new PageRule("2", 11, 0, 100, false))).toBe(false);
    expect(rule.eq(new PageRule("2", 10, 1, 100, false))).toBe(false);
    expect(rule.eq(new PageRule("2", 10, 0, 90, false))).toBe(false);
    expect(rule.eq(new PageRule("2", 10, 0, 100, true))).toBe(false);
    expect(rule.eq(new SceneNumber("2", 0) as unknown as LayerMarker)).toBe(false);
    const drawn = rule.draw();
    expect(drawn.className).toBe("page-rule");
    expect(drawn.textContent).toBe("2");
    expect(drawn.style.top).toBe("10px");
    const shifted = new PageRule("4", 20, 2, 80, true);
    expect(shifted.update(drawn, rule)).toBe(true);
    expect(drawn.textContent).toBe("4");
    expect(drawn.className).toContain("page-rule-after-blank");
    expect(drawn.style.left).toBe("2px");
    expect(shifted.update(drawn, scene as unknown as LayerMarker)).toBe(false);
    expect(scene.ignoreEvent()).toBe(true);
  });

  it("numbers the scene and leaves a later page rule out of the text", () => {
    const state = stateFor([
      { type: "scene", text: "ROOM" },
      ...Array.from({ length: 60 }, (_, index) => ({ type: "action" as const, text: `Line ${index}` })),
    ]);
    const widgets = specs(state).filter((range) => range.spec.widget);
    const scene = widgets.find((range) => range.spec.widget instanceof SceneNumber);
    expect(scene?.spec.widget).toBeInstanceOf(SceneNumber);
    expect(scene?.spec.side).toBe(-1);
    expect((scene?.spec.widget as SceneNumber).toDOM().textContent).toContain("1");
    expect(widgets.some((range) => range.spec.widget instanceof PageRule)).toBe(false);
    expect(pageBreakOffsets(state).length).toBeGreaterThan(0);
    const actionOnly = stateFor([{ type: "action", text: "Hello" }]);
    expect(specs(actionOnly).some((range) => range.spec.widget instanceof SceneNumber)).toBe(false);
    expect(pageBreakOffsets(actionOnly)).toEqual([]);
  });

  it("draws a page rule over the sheet and keeps the line whole", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const coords = vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation((pos: number) => ({
      top: 40 + pos,
      left: 8,
      right: 16,
      bottom: 56 + pos,
    }));
    const documentSnapshot = elementsDocument(normalizeElements([
      { type: "dialogue", text: "word ".repeat(400).trim() },
    ]));
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: documentSnapshot.text,
        extensions: [metadataExtensions(documentSnapshot), scriptDecorations, pageRuleLayer],
      }),
    });
    const breaks = pageBreakOffsets(view.state);
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks.every((at) => at > 0 && at < view.state.doc.length)).toBe(true);
    expect(view.contentDOM.querySelector(".page-rule")).toBeNull();
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBe(view.state.doc.lines);
    await paint();
    const rules = [...view.dom.querySelectorAll(".page-rule")];
    expect(rules.length).toBe(breaks.length);
    for (const rule of rules) {
      expect(rule.closest(".cm-line")).toBeNull();
      expect(rule.closest(".cm-content")).toBeNull();
      expect(rule.className).toBe("page-rule");
    }
    const at = breaks[0];
    view.dispatch({ selection: { anchor: at - 4, head: at + 4 } });
    expect(view.state.selection.main.from).toBe(at - 4);
    expect(view.state.selection.main.to).toBe(at + 4);
    view.dispatch({ changes: { from: at - 3, to: at + 3, insert: "across" } });
    expect(view.state.doc.sliceString(at - 3, at + 3)).toBe("across");
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBe(view.state.doc.lines);
    expect(view.contentDOM.querySelector(".page-rule")).toBeNull();
    const paged = elementsDocument(normalizeElements([
      { type: "scene", text: "ROOM" },
      ...Array.from({ length: 40 }, (_, index) => ({ type: "action" as const, text: `Line ${index}` })),
    ]));
    const pagedView = new EditorView({
      parent,
      state: EditorState.create({
        doc: paged.text,
        extensions: [metadataExtensions(paged), scriptDecorations, pageRuleLayer],
      }),
    });
    await paint();
    const lifted = [...pagedView.dom.querySelectorAll(".page-rule-after-blank")];
    expect(lifted.length).toBeGreaterThan(0);
    for (const rule of lifted) expect(rule.closest(".cm-content")).toBeNull();
    pagedView.destroy();
    view.destroy();
    coords.mockRestore();
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

function paint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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
