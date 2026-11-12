/** Display-only state shared by assistant bubbles until the next user message.
 * Rows stay in their original timeline positions, including interleaved reasoning.
 */
export class ToolCallGroup {
  private readonly calls = new Map<string, { row: HTMLElement; state: "running" | "done" | "error" | "stopped" }>();
  private summary: HTMLButtonElement | null = null;
  private open = false;

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
    for (const call of this.calls.values()) {
      if (call.state === "running") call.state = "stopped";
    }
    this.refresh();
  }

  private refresh(): void {
    if (!this.summary) return;
    const calls = [...this.calls.values()];
    const failures = calls.filter(call => call.state === "error").length;
    const running = calls.some(call => call.state === "running");
    const stopped = calls.some(call => call.state === "stopped");
    const status = [stopped ? "未完成" : "", running ? "正在执行" : "", failures ? `${failures} 次失败` : ""].filter(Boolean).join(" · ") || "已完成";
    this.summary.setText(`${!running && !failures && !stopped ? "✓ " : ""}工具调用 · ${calls.length} 次 · ${status} ${this.open ? "▴" : "▾"}`);
    this.summary.setAttribute("aria-expanded", String(this.open));
    this.summary.toggleClass("is-error", failures > 0);
    for (const call of calls) call.row.toggleClass("is-group-collapsed", !this.open);
  }
}
