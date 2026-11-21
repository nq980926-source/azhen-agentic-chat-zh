import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { mergeSettings, DEFAULT_SETTINGS } from "../src/settings-schema";
import { KnowledgeModeTransition, knowledgeToolBlocked, knowledgeFetchBlocked, knowledgeModeOverlay } from "../src/agent/knowledge-mode";
import { AZHEN_KNOWLEDGE_MCP_ENDPOINT as endpoint } from "../src/agent/azhen-knowledge-policy";
import { createMcpServerSettings, createMcpServerState } from "../src/mcp/settings";
import { AgentToolCallController } from "../src/agent/tool-call-controller";
import { SubagentRegistry } from "../src/tools/subagent-tool";
import { createAzhenFinanceTools, AzhenFinanceRuntime } from "../src/tools/azhen-finance-tools";
import { adaptKnowledgeStorage } from "../src/skills/knowledge-storage";
import { buildAgentParentTools, EMPTY_AGENT_RUNTIME_RESOURCES, loadAgentRuntimeResources } from "../src/agent/runtime-resources";
import { ReadMemo } from "../src/vault/read-memo";
import { FakeApp } from "./helpers/fake-vault";
import { createWebTools } from "../src/tools/web-tools";
import type { AgentTool } from "@earendil-works/pi-agent-core";

function settings(mode: "local" | "cloud" = "local") {
  return mergeSettings({ knowledgeMode: mode, mcp: { ...DEFAULT_SETTINGS.mcp, enabled: true,
    servers: [createMcpServerSettings({ id: "renamed", url: endpoint, enabled: true })] } });
}
function controller(state = settings()) {
  const approve = vi.fn(async (_request: { allowRemember?: boolean }) => ({ approved: true, remember: true }));
  const gate = new AgentToolCallController({ app: new FakeApp() as unknown as App,
    getSettings: () => state, confirmToolCall: approve, getTools: () => [], getProfiles: () => [],
    onUndoApplied: () => {}, subagentRegistry: new SubagentRegistry() });
  return { gate, approve };
}
const cloudRead = "mcp__renamed__read_file";

describe("knowledge isolation and compatibility", () => {
  it.each([cloudRead, "mcp__renamed__append_file", "mcp__renamed__search_content", "azhen_finance_query"])( "blocks old history tool %s before approval", async name => {
      const { gate, approve } = controller();
      expect(await gate.beforeToolCall({ toolCall: { id: "old", name }, args: { relative_path: "diary.md" } }))
        .toMatchObject({ block: true });
      expect(approve).not.toHaveBeenCalled();
    });
  it("never falls back to local body writes when cloud mode has no configured service", async () => {
    const s = mergeSettings({ knowledgeMode: "cloud" });
    const { gate, approve } = controller(s);
    expect(await gate.beforeToolCall({ toolCall: { id: "no-cloud", name: "write" }, args: { path: "diary.md", content: "wrong location" } })).toMatchObject({ block: true });
    expect(approve).not.toHaveBeenCalled();
  });
  it("keeps unrelated MCP and cloud mode available", () => {
    expect(knowledgeToolBlocked(settings(), "mcp__weather__forecast")).toBe(false);
    expect(knowledgeToolBlocked(settings("cloud"), cloudRead)).toBe(false);
  });
  it("does not discover/contact the Knowledge service in local mode", async () => {
    const network = vi.fn();
    const resources = await loadAgentRuntimeResources(new FakeApp() as unknown as App, settings(), network);
    expect(network).not.toHaveBeenCalled();
    expect(resources.mcpTools).toEqual([]);
  });
  it("filters stale cached MCP and finance registrations while retaining web and Memory", () => {
    const s = settings(); s.web.enabled = true; s.toolBudget.enabled = false;
    const tool = (name: string) => ({ name, label: name, parameters: {}, execute: vi.fn() } as unknown as AgentTool);
    const { tools } = buildAgentParentTools({ app: new FakeApp() as unknown as App, settings: s,
      resources: { ...EMPTY_AGENT_RUNTIME_RESOURCES, mcpTools: [tool(cloudRead), tool("mcp__weather__forecast")] },
      readMemo: new ReadMemo(), webFetch: vi.fn(), azhenMemoryEnabled: true,
      azhenMemoryTools: [tool("azhen_memory_propose")], azhenFinanceTools: [tool("azhen_finance_query")] });
    const names = tools.map(t => t.name);
    expect(names).not.toContain(cloudRead); expect(names).not.toContain("azhen_finance_query");
    for (const name of ["read", "vault_inspect", "write", "edit", "web_search", "fetch_url", "azhen_memory_propose", "mcp__weather__forecast"]) expect(names).toContain(name);
  });
  it("blocks direct invocation of an old finance object without reading MCP", async () => {
    const getMcpTools = vi.fn();
    const options = { app: new FakeApp() as unknown as App, getSettings: () => settings(), getMcpTools, getTurnContext: () => ({ messages: [] }) };
    expect(createAzhenFinanceTools(options)).toEqual([]);
    expect(await new AzhenFinanceRuntime(options).query({ from: "2026-11-01", to: "2026-11-02", chart: "none" })).toHaveProperty("isError", true);
    expect(getMcpTools).not.toHaveBeenCalled();
  });
  it("blocks knowledge Fetch but keeps ordinary DeepSeek search/fetch independent", async () => {
    const s = settings(); s.web.enabled = true; s.web.searchProvider = "deepseek"; s.web.searchApiKey = "test";
    const network = vi.fn();
    const tools = createWebTools(s.web, network, undefined, url => !knowledgeFetchBlocked(s, url));
    expect(tools.map(t => t.name)).toEqual(["web_search", "fetch_url"]);
    await expect(tools[1]!.execute("old", { url: endpoint })).rejects.toThrow(/knowledge/i);
    expect(network).not.toHaveBeenCalled();
    expect(knowledgeFetchBlocked(s, "https://example.org/article")).toBe(false);
  });
  it("asks for every local move/delete/whole overwrite even under YOLO and standing allow", async () => {
    const s = settings(); s.mode = "yolo"; s.approval.perTool = { rename: "allow", delete: "allow", write: "allow" };
    const { gate, approve } = controller(s);
    for (const [name, args] of [["rename", { path: "a.md", newPath: "b.md" }], ["delete", { path: "a.md" }], ["write", { path: "a.md", overwrite: true, content: "new" }]] as const) {
      await gate.beforeToolCall({ toolCall: { id: name, name }, args });
    }
    expect(approve).toHaveBeenCalledTimes(3);
    expect(approve.mock.calls.every(call => (call[0] as { allowRemember?: boolean }).allowRemember === false)).toBe(true);
  });
  it("allows local knowledge mutations with old cloud settings retained", async () => {
    const s = settings(); s.approval.mutating = "allow";
    expect(await controller(s).gate.beforeToolCall({ toolCall: { id: "local", name: "write" }, args: { path: "日记.md", content: "new" } })).toBeUndefined();
    s.knowledgeMode = "cloud";
    expect(await controller(s).gate.beforeToolCall({ toolCall: { id: "cloud", name: "write" }, args: { path: "日记.md", content: "new" } })).toMatchObject({ block: true });
  });
  it("preserves disabled cloud migration, explicit local selection and reinstall defaults", () => {
    const s = settings("cloud"); s.mcp.enabled = false; s.mcp.servers[0]!.enabled = false;
    const { knowledgeMode: _old, ...legacy } = s;
    expect(mergeSettings(legacy).knowledgeMode).toBe("cloud");
    expect(mergeSettings({ ...legacy, knowledgeMode: "local" }).knowledgeMode).toBe("local");
    expect(mergeSettings({}).knowledgeMode).toBe("local");
    expect(mergeSettings(null).knowledgeMode).toBe("local");
    const state = createMcpServerState("android", { lastUrl: endpoint, enabled: false });
    expect(mergeSettings({ plugins: { ...DEFAULT_SETTINGS.plugins, mcpState: { android: state } } }).knowledgeMode).toBe("cloud");
  });
  it("adapts only storage guidance without changing source or business rules", () => {
    const skill = { name: "阿斟财务", filePath: ".agentic-plugins/azhen-business-skills/skills/阿斟财务/SKILL.md", description: "finance",
      content: "# 财务\n教学经验保持\n日记格式保持\n音乐规则保持\n知识库正文只能通过 Knowledge MCP 修改。新建使用 create_file。\n统计口径不变\n" };
    const original = skill.content;
    expect(adaptKnowledgeStorage(skill, "cloud")).toBe(skill);
    const local = adaptKnowledgeStorage(skill, "local");
    for (const text of ["教学经验保持", "日记格式保持", "音乐规则保持", "统计口径不变"]) expect(local.content).toContain(text);
    expect(local.content).not.toContain("知识库正文只能通过 Knowledge MCP 修改");
    expect(skill.content).toBe(original);
    expect(knowledgeModeOverlay("local")).toContain("Memory remains");
  });
});

describe("all-tab knowledge transition", () => {
  it.each(["preparing", "executing", "approval", "writing"])("refuses a busy background tab: %s", async () => {
    const transition = new KnowledgeModeTransition(); const s = { knowledgeMode: "local" as const };
    const reset = vi.fn(), persist = vi.fn();
    await expect(transition.change(s, "cloud", [{ isTurnInFlight: () => false, resetKnowledgeContext: reset },
      { isTurnInFlight: () => true, resetKnowledgeContext: reset }], persist)).rejects.toThrow();
    expect(s.knowledgeMode).toBe("local"); expect(persist).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  });
  it("locks sends while persisting then clears every context/cache", async () => {
    const transition = new KnowledgeModeTransition(); const s = { knowledgeMode: "local" as "local" | "cloud" };
    let finish!: () => void; const reset = vi.fn();
    const change = transition.change(s, "cloud", [1, 2, 3].map(() => ({ isTurnInFlight: () => false, resetKnowledgeContext: reset })), () => new Promise<void>(resolve => { finish = resolve; }));
    expect(transition.active).toBe(true);
    await expect(transition.change(s, "local", [], async () => {})).rejects.toThrow();
    finish(); await change; expect(transition.active).toBe(false); expect(reset).toHaveBeenCalledTimes(3);
  });
  it("rolls back a failed settings save and invalidates old caches", async () => {
    const transition = new KnowledgeModeTransition(); const s = { knowledgeMode: "local" as "local" | "cloud" }; const reset = vi.fn();
    await expect(transition.change(s, "cloud", [{ isTurnInFlight: () => false, resetKnowledgeContext: reset }], async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(s.knowledgeMode).toBe("local"); expect(transition.active).toBe(false); expect(reset).toHaveBeenCalledOnce();
  });
});
