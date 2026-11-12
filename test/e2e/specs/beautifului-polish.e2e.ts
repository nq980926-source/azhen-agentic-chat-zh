import { browser, expect, $, $$ } from "@wdio/globals";
import { before, describe, it } from "mocha";

/**
 * Beautifului chat-polish + status-grammar e2e (deterministic, no model key):
 * drives `view.handleAgentEvent(...)` directly against a real running Obsidian.
 * Covers the Thinking pill lifecycle (mounted at message_start, settles to a
 * green-check "Thought" the moment the answer streams), tool/source chips, and
 * the no-text finalize/abort paths. Local-only, cheap.
 */

const VIEW_TYPE_AGENT_CHAT = "agentic-chat-chat-view";
const SOURCE_NOTE = "Notes/SourceA.md";

interface ProbeQuery {
  key: string;
  selector: string;
  attr?: string;
  all?: boolean;
}
type ProbeResult = Record<string, string | string[]>;

async function probe(query: ProbeQuery): Promise<ProbeResult> {
  return (await browser.execute((q) => {
    const out: Record<string, unknown> = {};
    const attr = q.attr;
    const nodes = q.all ? Array.from(document.querySelectorAll(q.selector)) : [document.querySelector(q.selector)];
    const values = nodes.filter(Boolean) as Element[];
    const read = (el: Element): string => (attr ? el.getAttribute(attr) ?? "" : (el as HTMLElement).innerText ?? (el.textContent ?? ""));
    out[q.key] = q.all ? values.map(read) : values.length > 0 ? read(values[0]) : "";
    return out;
  }, query)) as ProbeResult;
}

/** Dispatch one agent event through the live view (synchronous). */
async function emit(event: Record<string, unknown>): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, viewType, ev) => {
      const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as {
        handleAgentEvent?: (event: unknown) => void;
      };
      if (!view?.handleAgentEvent) throw new Error(`chat view missing handleAgentEvent for ${viewType}`);
      view.handleAgentEvent(ev);
    },
    VIEW_TYPE_AGENT_CHAT,
    event,
  );
}

async function openChat(): Promise<void> {
  await browser.executeObsidianCommand("agentic-chat:open-chat");
  await $(".agentic-chat-view").waitForExist();
}

async function startAssistantTurn(): Promise<void> {
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: { role: "assistant", content: [] } });
}

function streamDelta(type: string, delta: string): Record<string, unknown> {
  return { type: "message_update", assistantMessageEvent: { type, delta } };
}

function toolStart(id: string, name: string, args: Record<string, unknown>): Record<string, unknown> {
  return { type: "tool_execution_start", toolCallId: id, toolName: name, args };
}

function toolEnd(id: string, resultText = "ok", isError = false): Record<string, unknown> {
  return { type: "tool_execution_end", toolCallId: id, result: { output: resultText }, isError };
}

function assistantEndText(text: string): Record<string, unknown> {
  return { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function assistantEndEmpty(): Record<string, unknown> {
  return { type: "message_end", message: { role: "assistant", content: [] } };
}

describe("agentic-chat beautifului polish", function () {
  before(async function () {
    await browser.executeObsidian(async ({ app, obsidian }, paths, sourceNote) => {
      for (const note of paths) {
        if (!app.vault.getAbstractFileByPath(note)) await app.vault.create(note, `e2e source note: ${note}`);
      }
      const file = app.vault.getAbstractFileByPath(sourceNote);
      if (!(file instanceof obsidian.TFile)) throw new Error(`${sourceNote} was not created`);
    }, ["Notes/SourceA.md", "Notes/SourceB.md", "Notes/SourceC.md", "Notes/Out.md"], SOURCE_NOTE);
    await openChat();
  });

  it("mounts the Thinking pill immediately at message_start and flips to Thought on the first answer delta", async function () {
    const instant = await browser.executeObsidian(async ({ app }, viewType) => {
      const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as {
        handleAgentEvent?: (event: unknown) => void;
      };
      view?.handleAgentEvent?.({ type: "agent_start" });
      view?.handleAgentEvent?.({ type: "message_start", message: { role: "assistant", content: [] } });
      return {
        pills: document.querySelectorAll(".agentic-chat-reasoning").length,
        loaders: document.querySelectorAll(".agentic-chat-loading").length,
        label: document.querySelector<HTMLElement>(".agentic-chat-reasoning-label")?.textContent ?? "",
      };
    }, VIEW_TYPE_AGENT_CHAT);
    expect(instant.pills).toBe(1);
    expect(instant.loaders).toBe(0);
    expect(instant.label).toBe("Thinking");

    const done = await probe({ key: "cls", selector: ".agentic-chat-reasoning", attr: "class" });
    expect(done.cls).not.toContain("is-done");

    await browser.pause(250);
    const time = await probe({ key: "time", selector: ".agentic-chat-reasoning-time" });
    expect(time.time.length).toBeGreaterThan(0);

    await emit(streamDelta("text_delta", "first token"));
    await $(".agentic-chat-reasoning.is-done").waitForExist({ timeout: 2_000, timeoutMsg: "pill never settled on answer" });
    const settled = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-label" });
    expect(settled.label).toBe("Thought");
    await emit({ type: "agent_end" });
  });

  it("instant replies flip straight to Thought with no loader ever", async function () {
    await browser.executeObsidian(
      async ({ app }, viewType, events) => {
        const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as {
          handleAgentEvent?: (event: unknown) => void;
        };
        for (const ev of events as unknown[]) view?.handleAgentEvent?.(ev);
      },
      VIEW_TYPE_AGENT_CHAT,
      [
        { type: "agent_start" },
        { type: "message_start", message: { role: "assistant", content: [] } },
        streamDelta("text_delta", "instant reply"),
      ],
    );

    await browser.pause(400);
    const state = await probe({ key: "loaders", selector: ".agentic-chat-loading", all: true });
    expect(state.loaders).toEqual([]);
    await $(".agentic-chat-assistant:last-child .agentic-chat-reasoning.is-done").waitForExist({ timeout: 2_000 });
    const label = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-label" });
    expect(label.label).toBe("Thought");
    await emit({ type: "agent_end" });
  });

  it("live reasoning settles to Thought with a final elapsed timer once the answer streams", async function () {
    await startAssistantTurn();
    const live = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-label" });
    expect(live.label).toBe("Thinking");
    const done = await probe({ key: "cls", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning", attr: "class" });
    expect(done.cls).not.toContain("is-done");

    await emit(streamDelta("thinking_delta", "trace reasoning step one"));
    await browser.pause(250);
    const time = await probe({ key: "time", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-time" });
    expect(time.time.length).toBeGreaterThan(0);

    await emit(streamDelta("text_delta", "measured answer"));
    await emit(assistantEndText("measured answer"));

    await $(".agentic-chat-reasoning.is-done").waitForExist({ timeout: 2_000, timeoutMsg: "reasoning never settled" });
    const settled = await probe({ key: "label", selector: ".agentic-chat-reasoning.is-done .agentic-chat-reasoning-label" });
    expect(settled.label).toBe("Thought");
    const settledTime = await probe({ key: "time", selector: ".agentic-chat-reasoning-time" });
    expect(settledTime.time.length).toBeGreaterThan(0);
    const settledDot = await probe({ key: "count", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning.is-done .agentic-chat-reasoning-dot svg", all: true });
    expect(settledDot.count.length).toBe(1);
    await emit({ type: "agent_end" });
  });

  it("history-style near-instant turns collapse to a static Thought pill with no timer", async function () {
    await browser.executeObsidian(
      async ({ app }, viewType, events) => {
        const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as {
          handleAgentEvent?: (event: unknown) => void;
        };
        for (const ev of events as unknown[]) view?.handleAgentEvent?.(ev);
      },
      VIEW_TYPE_AGENT_CHAT,
      [
        { type: "agent_start" },
        { type: "message_start", message: { role: "assistant", content: [] } },
        streamDelta("thinking_delta", "cached trace"),
        assistantEndText("cached answer"),
      ],
    );

    await $(".agentic-chat-reasoning.is-done").waitForExist({ timeout: 2_000, timeoutMsg: "reasoning never settled" });
    const settled = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning.is-done .agentic-chat-reasoning-label" });
    expect(settled.label).toBe("Thought");
    const settledTime = await probe({ key: "time", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-time" });
    expect(settledTime.time).toBe("");
    await emit({ type: "agent_end" });
  });

  it("renders deduped source chips only for read-style tools and opens the note on click", async function () {
    await startAssistantTurn();
    await emit(toolStart("t-read-a", "read", { path: "Notes/SourceA.md" }));
    await emit(toolEnd("t-read-a"));
    await emit(toolStart("t-read-a2", "read", { path: "Notes/SourceA.md" }));
    await emit(toolEnd("t-read-a2"));
    await emit(toolStart("t-active", "get_active_note", { path: "Notes/SourceB.md" }));
    await emit(toolEnd("t-active"));
    await emit(toolStart("t-edit", "edit", { path: "Notes/SourceC.md" }));
    await emit(toolEnd("t-edit"));
    await emit(toolStart("t-write", "write", { path: "Notes/Out.md" }));
    await emit(toolEnd("t-write"));
    await emit(toolStart("t-del", "delete", { path: "Notes/Gone.md" }));
    await emit(toolEnd("t-del"));
    await emit(assistantEndText("summarised the notes"));

    await $(".agentic-chat-source-chip").waitForExist({ timeout: 2_000, timeoutMsg: "source chips never rendered" });
    const names = await probe({ key: "names", selector: ".agentic-chat-source-chip-name", all: true });
    expect(names.names).toEqual(["SourceA.md", "SourceB.md", "SourceC.md"]);

    await browser.execute(() => {
      const chip = document.querySelector<HTMLButtonElement>(".agentic-chat-source-chip");
      if (!chip) throw new Error("source chip not found");
      chip.click();
    });
    await browser.waitUntil(
      async () =>
        await browser.executeObsidian(
          async ({ app }, path) => app.workspace.getActiveFile()?.path === path,
          "Notes/SourceA.md",
        ),
      { timeout: 5_000, timeoutMsg: "clicking a source chip did not open its note" },
    );
    await emit({ type: "agent_end" });
  });

  it("caps the chip row at 8 with a +N overflow counter", async function () {
    await startAssistantTurn();
    for (let index = 0; index < 10; index += 1) {
      const id = `t-cap-${index}`;
      await emit(toolStart(id, "read", { path: `Notes/SourceD${index}.md` }));
      await emit(toolEnd(id));
    }
    await emit(assistantEndText("ten reads"));
    await browser.waitUntil(
      async () => {
        const chips = await probe({ key: "names", selector: ".agentic-chat-assistant:last-child .agentic-chat-source-chip", all: true });
        return chips.names.length === 8;
      },
      { timeout: 2_000, timeoutMsg: "chip row never reached its 8-chip cap" },
    );
    const more = await probe({ key: "more", selector: ".agentic-chat-assistant:last-child .agentic-chat-sources-more" });
    expect(more.more).toBe("+2");
    await emit({ type: "agent_end" });
  });

  it("finalizes text-less tool-only turns without markdown, keeps chips, and settles chrome exactly once", async function () {
    await startAssistantTurn();
    await emit(toolStart("t-solo", "read", { path: SOURCE_NOTE }));
    await emit(toolEnd("t-solo"));
    await emit(assistantEndEmpty());
    await emit({ type: "agent_end" });

    await browser.waitUntil(
      async () => {
        const chips = await probe({ key: "count", selector: ".agentic-chat-assistant:last-child .agentic-chat-source-chip", all: true });
        const sourceRows = await probe({ key: "count", selector: ".agentic-chat-assistant:last-child .agentic-chat-sources", all: true });
        const pills = await probe({ key: "cls", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning", attr: "class" });
        return chips.count.length === 1 && sourceRows.count.length === 1 && pills.cls.includes("is-done");
      },
      { timeout: 2_000, timeoutMsg: "tool-only turn did not settle cleanly" },
    );
    const settled = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-label" });
    expect(settled.label).toBe("Thought");
    const name = await probe({ key: "name", selector: ".agentic-chat-assistant:last-child .agentic-chat-source-chip-name" });
    expect(name.name).toBe("SourceA.md");
    const text = await probe({ key: "text", selector: ".agentic-chat-assistant:last-child .agentic-chat-text" });
    expect(text.text).toBe("");
  });

  it("shows a single aggregated subagent status pill with exclusive Stop/Done", async function () {
    await startAssistantTurn();
    await emit(toolStart("t-sub", "subagent", { agent: "explorer", task: "map the vault" }));
    const childrenFor = (statuses: ("running" | "done")[]) =>
      statuses.map((status, index) => ({
        agent: "explorer",
        task: `task ${index + 1}`,
        status,
        ...(status === "running" ? { stopId: `s${index}` } : {}),
        transcript: [] as never[],
        summary: status === "done" ? "summary" : "",
      }));
    await emit({
      type: "tool_execution_update",
      toolCallId: "t-sub",
      partialResult: { details: { kind: "subagent", children: childrenFor(["running", "done"]) } },
    });
    const runningPill = await probe({ key: "status", selector: ".agentic-chat-assistant:last-child .agentic-chat-step-status" });
    expect(runningPill.status).toBe("Running…");
    const stopsRunning = await probe({ key: "stop", selector: ".agentic-chat-assistant:last-child .agentic-chat-subagent .agentic-chat-subagent-stop", all: true });
    expect(stopsRunning.stop.length).toBe(1);

    await emit({
      type: "tool_execution_update",
      toolCallId: "t-sub",
      partialResult: {
        details: {
          kind: "subagent",
          children: [
            { agent: "explorer", task: "task 1", status: "done", transcript: [], summary: "summary", durationMs: 125_000, usage: { input: 4_000, output: 800, totalTokens: 4_800, costUsd: 0.012 } },
            { agent: "explorer", task: "task 2", status: "done", transcript: [], summary: "summary", durationMs: 90_000, usage: { input: 2_000, output: 500, totalTokens: 2_500, costUsd: 0.006 } },
          ],
        },
      },
    });
    await browser.waitUntil(
      async () => {
        const pill = await probe({ key: "status", selector: ".agentic-chat-assistant:last-child .agentic-chat-step-status" });
        return pill.status === "Done";
      },
      { timeout: 2_000, timeoutMsg: "aggregate pill never flipped to Done" },
    );
    const stopsDone = await probe({ key: "stop", selector: ".agentic-chat-assistant:last-child .agentic-chat-subagent .agentic-chat-subagent-stop", all: true });
    expect(stopsDone.stop.length).toBe(0);
    // Settled children carry a subtle duration · tokens · cost readout.
    const meta = await probe({ key: "meta", selector: ".agentic-chat-assistant:last-child .agentic-chat-subagent-meta", all: true });
    expect(meta.meta.length).toBe(2);
    for (const line of meta.meta) {
      expect(line).toMatch(/tok/);
      expect(line).toContain("$");
    }
    await emit(toolEnd("t-sub"));
    await emit(assistantEndEmpty());
    await emit({ type: "agent_end" });
  });

  it("labels a stopped child as stopped, not failed, and never shows a green check on the Dispatch step", async function () {
    await startAssistantTurn();
    await emit(toolStart("t-stop", "subagent", { agent: "explorer", task: "hang" }));
    await emit({
      type: "tool_execution_update",
      toolCallId: "t-stop",
      partialResult: { details: { kind: "subagent", children: [{ agent: "explorer", task: "hang", status: "aborted", transcript: [], summary: "Stopped by user" }] } },
    });
    const status = await probe({ key: "status", selector: ".agentic-chat-assistant:last-child .agentic-chat-subagent-status" });
    expect(status.status).toBe("stopped");
    const pill = await probe({ key: "pill", selector: ".agentic-chat-assistant:last-child .agentic-chat-step-status" });
    expect(pill.pill).toBe("Stopped");
    // Production contract: the stopped dispatch settles as a NORMAL result
    // (isError:false — no re-dispatch pressure); the red x-circle comes from the
    // endStep derivation over the persisted child statuses, so assert that path.
    await emit({
      type: "tool_execution_end",
      toolCallId: "t-stop",
      result: {
        content: [{ type: "text", text: 'Subagent "explorer" was stopped: Stopped by user' }],
        details: { kind: "subagent", children: [{ agent: "explorer", task: "hang", status: "aborted", transcript: [], summary: "Stopped by user" }] },
      },
      isError: false,
    });
    const icon = await probe({ key: "icon", selector: ".agentic-chat-assistant:last-child .agentic-chat-step-icon svg", attr: "class" });
    expect(icon.icon).toContain("x-circle");
    const card = await probe({ key: "cls", selector: ".agentic-chat-assistant:last-child .agentic-chat-step", attr: "class" });
    expect(card.cls).toContain("is-error");
    await emit(assistantEndEmpty());
    await emit({ type: "agent_end" });
  });

  it("aborting mid-thinking settles the pill and leaves no loader behind", async function () {
    await startAssistantTurn();
    await browser.pause(200);
    const pre = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-label" });
    expect(pre.label).toBe("Thinking");
    await emit(assistantEndEmpty());
    await emit({ type: "agent_end" });

    const loaders = await probe({ key: "count", selector: ".agentic-chat-loading", all: true });
    expect(loaders.count).toEqual([]);
    const label = await probe({ key: "label", selector: ".agentic-chat-assistant:last-child .agentic-chat-reasoning-label" });
    expect(label.label).toBe("Thought");
    const bubbles = await probe({ key: "count", selector: ".agentic-chat-assistant", all: true });
    expect(bubbles.count.length).toBeGreaterThan(0);
  });
  it("groups tools across assistant messages, retains expansion, and separates users", async function () {
    await emit({ type: "message_start", message: { role: "user", content: [] } });
    await startAssistantTurn();
    await emit(toolStart("group-1", "ls", {}));
    await emit(toolEnd("group-1"));
    const summary = (await $$(".agentic-chat-tool-summary")).at(-1)!;
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.click();
    await emit({ type: "message_start", message: { role: "assistant", content: [] } });
    await emit(streamDelta("thinking_delta", "second reasoning"));
    await emit(toolStart("group-2", "ls", {}));
    await emit(toolEnd("group-2", "failed", true));
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(summary).toHaveText(expect.stringContaining("2 次 · 1 次失败"));
    await (await $$(".agentic-chat-activity-summary")).at(-1)!.click();
    await summary.click();
    const state = await browser.execute(() => ({
      collapsed: document.querySelectorAll(".agentic-chat-step-row.is-group-collapsed").length,
      overflow: Array.from(document.querySelectorAll(".agentic-chat-tool-summary")).some(el => el.scrollWidth > el.clientWidth + 1),
    }));
    expect(state.collapsed).toBeGreaterThanOrEqual(2);
    expect(state.overflow).toBe(false);
    await emit({ type: "agent_end" });
    await emit({ type: "message_start", message: { role: "user", content: [] } });
    await startAssistantTurn();
    await emit(toolStart("group-3", "ls", {}));
    await expect($(".agentic-chat-assistant:last-child .agentic-chat-tool-summary")).toHaveText(expect.stringContaining("1 次 · 正在执行"));
    await emit(toolEnd("group-3"));
    await emit({ type: "agent_end" });
  });


  it("replays historical tool groups at user boundaries without changing message data", async function () {
    const state = await browser.executeObsidian(async ({ app }, viewType) => {
      const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as { renderTranscript(messages: unknown[]): void };
      const call = (id: string) => ({ role: "assistant", content: [{ type: "thinking", thinking: "trace" }, { type: "toolCall", id, name: "ls", arguments: {} }] });
      const result = (id: string, isError: boolean) => ({ role: "toolResult", toolCallId: id, isError, content: [{ type: "text", text: "detail" }] });
      const messages = [
        { role: "user", content: "first" }, call("history-1"), result("history-1", false),
        call("history-2"), result("history-2", true),
        { role: "user", content: "second" }, call("history-3"), result("history-3", false),
      ];
      const before = JSON.stringify(messages);
      view.renderTranscript(messages);
      return {
        labels: Array.from(document.querySelectorAll(".agentic-chat-tool-summary:not(.agentic-chat-activity-summary)")).map(el => el.textContent),
        outer: Array.from(document.querySelectorAll(".agentic-chat-activity-summary")).map(el => el.textContent),
        order: Array.from(document.querySelectorAll(".agentic-chat-reasoning, .agentic-chat-step-row")).map(el => el.classList.contains("agentic-chat-reasoning") ? "thought" : "tool"),
        collapsed: document.querySelectorAll(".agentic-chat-step-row.is-group-collapsed").length,
        reasoning: document.querySelectorAll(".agentic-chat-reasoning").length,
        unchanged: JSON.stringify(messages) === before,
      };
    }, VIEW_TYPE_AGENT_CHAT);
    expect(state.labels).toHaveLength(2);
    expect(state.labels[0]).toContain("2 次 · 1 次失败");
    expect(state.labels[1]).toContain("1 次 · 已完成");
    expect(state.collapsed).toBe(3);
    expect(state.reasoning).toBe(3);
    expect(state.outer).toHaveLength(2);
    expect(state.outer[0]).toContain("3 项 · 1 次失败");
    expect(state.outer[1]).toContain("2 项 · 已完成");
    expect(state.order).toEqual(["thought", "tool", "thought", "tool", "thought", "tool"]);
    const outer = $(".agentic-chat-activity-summary");
    await expect(outer).toHaveAttribute("aria-expanded", "false");
    await outer.click();
    await expect(outer).toHaveAttribute("aria-expanded", "true");
    expect(state.unchanged).toBe(true);
  });

});