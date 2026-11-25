import { editorLivePreviewField, type Plugin } from "obsidian";
import { Prec, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { PhotoRenderChild } from "./renderer";
import type { PhotoCache } from "./cache";

/** Reuse the native editor and photo renderer; no document mutation or second reader. */
export function registerPhotoEditor(plugin: Plugin, cache: PhotoCache): void {
  class PhotoWidget extends WidgetType {
    private child?: PhotoRenderChild;
    private observer?: ResizeObserver;
    constructor(readonly id: string, readonly caption: string) { super(); }
    eq(other: PhotoWidget): boolean { return this.id === other.id && this.caption === other.caption; }
    toDOM(view: EditorView): HTMLElement {
      const span = view.dom.ownerDocument.createElement("span"); span.className = "azhen-photo azhen-photo-editor";
      span.dataset.photoId = this.id;
      this.child = new PhotoRenderChild(span, cache, this.id, this.caption);
      this.child.load();
      if (typeof ResizeObserver !== "undefined") { this.observer = new ResizeObserver(() => view.requestMeasure()); this.observer.observe(span); }
      return span;
    }
    destroy(): void { this.observer?.disconnect(); this.child?.unload(); this.child = undefined; }
  }
  const create = (state: EditorState): DecorationSet => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    const ranges = [];
    let fence = ""; let length = 0; let frontmatter = false; let comment = false;
    for (let number = 1; number <= state.doc.lines; number++) {
      const line = state.doc.line(number); const text = line.text;
      if (number === 1 && text.trim() === "---") { frontmatter = true; continue; }
      if (frontmatter) { if (/^(---|\.\.\.)\s*$/.test(text)) frontmatter = false; continue; }
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
      if (marker && !comment) {
        if (!fence) { fence = marker[1][0]; length = marker[1].length; }
        else if (marker[1][0] === fence && marker[1].length >= length && !marker[2].trim()) fence = "";
        continue;
      }
      if (fence) continue;
      const start = text.lastIndexOf("<!--"); const end = text.lastIndexOf("-->");
      if (start > end) comment = true; else if (end >= 0) comment = false;
      if (comment) continue;
      const match = /^!\[([^\]\n]*)\]\(azhen-photo:\/\/v1\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)[ \t]*$/.exec(text);
      if (!match || state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from)) continue;
      ranges.push(Decoration.replace({ widget: new PhotoWidget(match[2], match[1]), block: true }).range(line.from, line.to));
    }
    return Decoration.set(ranges, true);
  };
  const field = StateField.define<DecorationSet>({
    create,
    update(value, transaction) {
      return transaction.docChanged || transaction.selection || transaction.startState.field(editorLivePreviewField, false) !== transaction.state.field(editorLivePreviewField, false) ? create(transaction.state) : value;
    },
    provide: value => EditorView.decorations.from(value),
  });
  plugin.registerEditorExtension(Prec.highest(field));
}
