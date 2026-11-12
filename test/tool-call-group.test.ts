import { describe, expect, it } from "vitest";
import { ToolCallGroup } from "../src/ui/tool-call-group";
class Node {
  children: Node[] = [];
  parentElement: Node | null = null;
  text = "";
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  click = () => {};
  createEl() { const n = new Node(); n.parentElement = this; this.children.push(n); return n; }
  insertBefore(n: Node, before: Node) { this.children = this.children.filter(c => c !== n); this.children.splice(this.children.indexOf(before), 0, n); }
  addEventListener(_type: string, fn: () => void) { this.click = fn; }
  setText(s: string) { this.text = s; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  toggleClass(c: string, on: boolean) { if (on) this.classes.add(c); else this.classes.delete(c); }
}
const add = (g: ToolCallGroup, parent: Node, id: string) => { const row = parent.createEl(); g.add(id, row as unknown as HTMLElement); return row; };
describe("per-user-turn tool summary", () => {
  it("does not claim success for interrupted or missing historical results", () => {
    const g = new ToolCallGroup(), p = new Node(); add(g,p,"unfinished"); g.finish();
    expect(p.children[0].text).toContain("未完成");
    expect(p.children[0].text).not.toContain("✓");
  });
  it("has no empty summary", () => { const p = new Node(); new ToolCallGroup(); expect(p.children).toHaveLength(0); });
  it("defaults collapsed, counts once, settles success", () => {
    const g = new ToolCallGroup(), p = new Node(); const row = add(g,p,"1");
    g.add("1", row as unknown as HTMLElement);
    expect(p.children[0].text).toContain("1 次 · 正在执行");
    expect(row.classes.has("is-group-collapsed")).toBe(true);
    g.settle("1",false); expect(p.children[0].text).toContain("✓ 工具调用 · 1 次 · 已完成");
  });
  it("keeps one summary across bubbles and retains expansion during streaming", () => {
    const g = new ToolCallGroup(), a = new Node(), b = new Node(); const r1 = add(g,a,"1");
    const summary = a.children[0]; summary.click(); const r2 = add(g,b,"2");
    g.settle("1",false); g.settle("2",true);
    expect(a.children[0]).toBe(summary); expect(b.children).toEqual([r2]);
    expect(summary.text).toContain("2 次 · 1 次失败");
    expect(r1.classes.size + r2.classes.size).toBe(0);
    summary.click(); expect(r2.classes.has("is-group-collapsed")).toBe(true);
  });
  it("shows failures even while another call runs and separates user turns", () => {
    const a = new ToolCallGroup(), b = new ToolCallGroup(), p = new Node(), q = new Node();
    add(a,p,"1"); add(a,p,"2"); a.settle("1",true); add(b,q,"1");
    expect(p.children[0].text).toContain("2 次 · 正在执行 · 1 次失败");
    expect(q.children[0].text).toContain("1 次 · 正在执行");
  });
  it("preserves interleaved nodes and long details without remounting", () => {
    const g = new ToolCallGroup(), p = new Node(); const a = add(g,p,"1");
    const reasoning = p.createEl(); reasoning.text = "thinking";
    const b = add(g,p,"2"); b.text = "result".repeat(10000);
    const original = [...p.children]; p.children[0].click(); g.settle("2",false);
    expect(p.children).toEqual(original); expect(b.text.length).toBe(60000); expect(p.children.indexOf(a)).toBeLessThan(p.children.indexOf(reasoning));
  });
});

describe("thought and tool outer summary", () => {
  const reasoning = (g: ToolCallGroup, p: Node) => {
    const n = p.createEl(); n.text = "original reasoning";
    g.reasoning(n as unknown as HTMLElement, true);
    return n;
  };
  it("collapses reasoning alone and settles without altering its details", () => {
    const g = new ToolCallGroup(), p = new Node(); const r = reasoning(g,p);
    const summary = p.children[0];
    expect(summary.text).toContain("思考与工具调用 · 1 项 · 进行中");
    expect(r.classes.has("is-activity-collapsed")).toBe(true);
    summary.click(); g.finish();
    expect(summary.text).toContain("已完成");
    expect(r.classes.has("is-activity-collapsed")).toBe(false);
    expect(r.text).toBe("original reasoning");
  });
  it("preserves interleaved order and independent inner expansion as tools stream", () => {
    const g = new ToolCallGroup(), p = new Node(), q = new Node();
    const a = reasoning(g,p); const tool1 = add(g,p,"a"); const b = reasoning(g,q);
    const answer = q.createEl(); answer.text = "final answer";
    const outer = p.children[0], inner = p.children[2];
    outer.click(); inner.click();
    const tool2 = add(g,q,"b"); const originalP = [...p.children], originalQ = [...q.children];
    g.settle("a",false); g.settle("b",true); g.finish();
    expect(outer.text).toContain("3 项 · 1 次失败");
    expect(a.classes.has("is-activity-collapsed")).toBe(false);
    expect(b.classes.has("is-activity-collapsed")).toBe(false);
    expect(tool2.classes.has("is-group-collapsed")).toBe(false);
    outer.click(); expect(tool1.classes.has("is-activity-collapsed")).toBe(true);
    outer.click(); expect(tool1.classes.has("is-group-collapsed")).toBe(false);
    expect(p.children).toEqual(originalP); expect(q.children).toEqual(originalQ);
    expect(answer.classes.size).toBe(0); expect(answer.text).toBe("final answer");
  });
  it("puts the outer summary before tools when actual reasoning arrives later", () => {
    const g = new ToolCallGroup(), p = new Node(), q = new Node(); add(g,p,"a");
    const inner = p.children[0]; reasoning(g,q);
    expect(p.children[1]).toBe(inner); expect(p.children[0].text).toContain("2 项");
    expect(inner.classes.has("is-activity-collapsed")).toBe(true);
  });
  it("does not count empty status shells as reasoning or show an empty summary", () => {
    const g = new ToolCallGroup(), p = new Node(); const empty = p.createEl();
    g.reasoning(empty as unknown as HTMLElement, false);
    expect(p.children).toEqual([empty]); expect(empty.classes.has("is-activity-collapsed")).toBe(true);
    add(g,p,"tool"); expect(p.children[1].text).toContain("工具调用 · 1 次");
    expect(p.children).toHaveLength(3);
  });
  it("deduplicates reasoning updates and isolates turn controllers", () => {
    const g = new ToolCallGroup(), other = new ToolCallGroup(), p = new Node(), q = new Node();
    const r = reasoning(g,p); g.reasoning(r as unknown as HTMLElement,true);
    reasoning(other,q); p.children[0].click();
    expect(p.children[0].text).toContain("1 项");
    expect(q.children[1].classes.has("is-activity-collapsed")).toBe(true);
  });
});
