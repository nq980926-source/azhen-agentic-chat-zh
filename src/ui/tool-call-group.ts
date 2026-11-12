/** Display-only state shared by assistant bubbles until the next user message.
 * Rows stay in their original timeline positions, including interleaved reasoning.
 */
export class ToolCallGroup {
  private readonly calls = new Map<string, { row: HTMLElement; state: "running" | "done" | "error" | "stopped" }>();
  private summary: HTMLButtonElement | null = null;
  private open = false;
  private readonly thoughts = new Map<HTMLElement, { content: boolean; running: boolean }>();
  private outer: HTMLButtonElement | null = null;
  private outerOpen = false;
  private firstRecord: HTMLElement | null = null;

  /** Register the original details node; empty eager status shells are not items. */
  reasoning(row: HTMLElement, content: boolean): void {
    const thought = this.thoughts.get(row) ?? { content: false, running: true };
    thought.content ||= content;
    this.thoughts.set(row, thought);
    if (thought.content && !this.outer) {
      this.firstRecord ??= row;
      const anchor = this.firstRecord;
      this.outer = anchor.parentElement!.createEl("button", {
        cls: "agentic-chat-tool-summary agentic-chat-activity-summary",
        attr: { type: "button", "aria-expanded": "false" },
      });
      anchor.parentElement!.insertBefore(this.outer, anchor);
      this.outer.addEventListener("click", () => {
        this.outerOpen = !this.outerOpen;
        this.refresh();
      });
    }
    this.refresh();
  }

  settleReasoning(row: HTMLElement): void {
    const thought = this.thoughts.get(row);
    if (thought) thought.running = false;
    this.refresh();
  }

  add(id: string, row: HTMLElement): void {
    if (this.calls.has(id)) return;
    if (!this.summary) {
      this.summary = row.parentElement!.createEl("button", {
        cls: "agentic-chat-tool-summary",
        attr: { type: "button", "aria-expanded": "false" },
      });
      row.parentElement!.insertBefore(this.summary, row);
      this.summary.addEventListener("click", () => {
        this.open = !this.open;
        this.refresh();
      });
    }
    this.firstRecord ??= this.summary;
    this.calls.set(id, { row, state: "running" });
    this.refresh();
  }

  settle(id: string, failed: boolean): void {
    const call = this.calls.get(id);
    if (!call) return;
    call.state = failed ? "error" : "done";
    this.refresh();
  }

  finish(): void {
    for (const thought of this.thoughts.values()) thought.running = false;
    for (const call of this.calls.values()) {
      if (call.state === "running") call.state = "stopped";
    }
    this.refresh();
  }

  private refresh(): void {
    const calls = [...this.calls.values()];
    const failures = calls.filter(call => call.state === "error").length;
    const running = calls.some(call => call.state === "running");
    const stopped = calls.some(call => call.state === "stopped");
    const status = [stopped ? "未完成" : "", running ? "正在执行" : "", failures ? `${failures} 次失败` : ""].filter(Boolean).join(" · ") || "已完成";
    this.summary?.setText(`${!running && !failures && !stopped ? "✓ " : ""}工具调用 · ${calls.length} 次 · ${status} ${this.open ? "▴" : "▾"}`);
    this.summary?.setAttribute("aria-expanded", String(this.open));
    this.summary?.toggleClass("is-error", failures > 0);
    const thoughts = [...this.thoughts.values()].filter(thought => thought.content);
    const hidden = !!this.outer && !this.outerOpen;
    if (this.outer) {
      const thinking = thoughts.some(thought => thought.running);
      const outerStatus = [stopped ? "未完成" : "", thinking || running ? "进行中" : "", failures ? `${failures} 次失败` : ""].filter(Boolean).join(" · ") || "已完成";
      this.outer.setText(`${this.outerOpen ? "▾" : "▸"} 思考与工具调用 · ${thoughts.length + (calls.length ? 1 : 0)} 项 · ${outerStatus}`);
      this.outer.setAttribute("aria-expanded", String(this.outerOpen));
      this.outer.toggleClass("is-error", failures > 0);
    }
    this.summary?.toggleClass("is-activity-collapsed", hidden);
    for (const [row, thought] of this.thoughts) row.toggleClass("is-activity-collapsed", !thought.content || hidden);
    for (const call of calls) {
      call.row.toggleClass("is-group-collapsed", !this.open);
      call.row.toggleClass("is-activity-collapsed", hidden);
    }
  }
}
