import { browser, expect, $ } from "@wdio/globals";
import { before, describe, it } from "mocha";
import { openAgenticChatSettings, selectSettingsTab, setSettingSelect, closeAgenticChatSettings } from "../support/settings-ui";

describe("local knowledge settings in real Obsidian", function () {
  before(async function () {
    await browser.executeObsidianCommand("agentic-chat:open-chat");
    await $(".agentic-chat-view").waitForExist();
  });
  it("persists both knowledge modes through the actual settings dropdown", async function () {
    await openAgenticChatSettings();
    await selectSettingsTab("Agent");
    await setSettingSelect("知识库工作模式", "cloud");
    await closeAgenticChatSettings();
    const cloud = await browser.executeObsidian(({ app }) => (app as unknown as { plugins: { plugins: Record<string, { settings: { knowledgeMode: string } }> } }).plugins.plugins["agentic-chat"]!.settings.knowledgeMode);
    expect(cloud).toBe("cloud");
    await openAgenticChatSettings(); await selectSettingsTab("Agent");
    await setSettingSelect("知识库工作模式", "local"); await closeAgenticChatSettings();
    const local = await browser.executeObsidian(({ app }) => (app as unknown as { plugins: { plugins: Record<string, { settings: { knowledgeMode: string } }> } }).plugins.plugins["agentic-chat"]!.settings.knowledgeMode);
    expect(local).toBe("local");
  });
  it("wires every chat tab into the transition and refuses a busy background tab", async function () {
    await $(".agentic-chat-tab-add").click();
    const result = await browser.executeObsidian(async ({ app }) => {
      type Service = { isTurnInFlight: () => boolean };
      type Plugin = { settings: { knowledgeMode: string }; requestKnowledgeModeChange: (mode: string) => Promise<boolean> };
      const plugin = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins["agentic-chat"]!;
      const views = app.workspace.getLeavesOfType("agentic-chat-chat-view");
      const services = views.flatMap(leaf => (leaf.view as unknown as { knowledgeParticipants: () => Service[] }).knowledgeParticipants());
      const background = services[0]!;
      const original = background.isTurnInFlight;
      background.isTurnInFlight = () => true;
      try {
        const changed = await plugin.requestKnowledgeModeChange("cloud");
        return { changed, mode: plugin.settings.knowledgeMode, count: services.length };
      } finally { background.isTurnInFlight = original; }
    });
    expect(result.count).toBeGreaterThanOrEqual(2); expect(result.changed).toBe(false); expect(result.mode).toBe("local");
  });
  it("runs native Vault creation and conflict refusal with registered production tools", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      type Tool = { name: string; execute: (id: string, args: unknown) => Promise<unknown> };
      type Service = { initialize: () => Promise<void>; agent?: { state: { tools: Tool[] } }; runtimeResources: { reload: () => Promise<void>; buildParentTools: (settings: unknown) => Tool[] } };
      const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: unknown; createAgentService: () => Service }> } }).plugins.plugins["agentic-chat"]!;
      const service = plugin.createAgentService();
      await service.runtimeResources.reload();
      const tools = service.runtimeResources.buildParentTools(plugin.settings);
      const call = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute("native", args);
      const path = "E2E-Local-Knowledge.md";
      const existing = app.vault.getFileByPath(path); if (existing) await app.fileManager.trashFile(existing);
      await call("write", { path, content: "original\nkeep" });
      await call("read", { path });
      await app.vault.modify(app.vault.getFileByPath(path)!, "original\nexternal");
      let conflict = false;
      try { await call("edit", { path, edits: [{ oldText: "original", newText: "lost" }] }); } catch { conflict = true; }
      const body = await app.vault.read(app.vault.getFileByPath(path)!);
      await call("read", { path });
      await call("edit", { path, edits: [{ oldText: "external", newText: "confirmed" }] });
      const after = await app.vault.read(app.vault.getFileByPath(path)!);
      await app.fileManager.trashFile(app.vault.getFileByPath(path)!);
      return { conflict, body, after };
    });
    expect(result).toEqual({ conflict: true, body: "original\nexternal", after: "original\nconfirmed" });
  });
  it("blocks context preparation and queued turns, then clears context caches on switch", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      type Cache = { clear: () => void };
      type View = { knowledgePreparations: number; queuedPromptArmed: boolean; activeNoteCache: Cache; contextCache: Cache };
      const view = app.workspace.getLeavesOfType("agentic-chat-chat-view")[0]!.view as unknown as View;
      const plugin = (app as unknown as { plugins: { plugins: Record<string, { requestKnowledgeModeChange: (mode: string) => Promise<boolean> }> } }).plugins.plugins["agentic-chat"]!;
      view.knowledgePreparations = 1;
      const preparing = await plugin.requestKnowledgeModeChange("cloud"); view.knowledgePreparations = 0;
      view.queuedPromptArmed = true;
      const queued = await plugin.requestKnowledgeModeChange("cloud"); view.queuedPromptArmed = false;
      let cleared = 0;
      const activeClear = view.activeNoteCache.clear.bind(view.activeNoteCache), contextClear = view.contextCache.clear.bind(view.contextCache);
      view.activeNoteCache.clear = () => { cleared++; activeClear(); };
      view.contextCache.clear = () => { cleared++; contextClear(); };
      try {
        const switched = await plugin.requestKnowledgeModeChange("cloud");
        await plugin.requestKnowledgeModeChange("local");
        return { preparing, queued, switched, cleared };
      } finally { view.activeNoteCache.clear = activeClear; view.contextCache.clear = contextClear; }
    });
    expect(result.preparing).toBe(false); expect(result.queued).toBe(false); expect(result.switched).toBe(true); expect(result.cleared).toBeGreaterThanOrEqual(4);
  });

});
