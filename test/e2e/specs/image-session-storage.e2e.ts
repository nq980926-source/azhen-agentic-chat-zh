import { browser, expect, $ } from "@wdio/globals";
import { describe, it } from "mocha";

describe("large image history without large native file transfers", () => {
  it("persists repeated original PNGs once and renders them after history reload", async () => {
    await browser.executeObsidianCommand("agentic-chat:open-chat");
    await $(".agentic-chat-view").waitForExist();
    const result = await browser.executeObsidian(async ({ app }) => {
      type Manager = {
        createSession(value: { provider: string; modelId: string; thinkingLevel: string }): Promise<{ path: string }>;
        appendMessage(value: unknown): Promise<string>;
        buildSessionContext(): { messages: Array<{ content: Array<{ type: string; data?: string }> }> };
      };
      type View = { service: { initialize(): Promise<void>; sessions: { sessionManager: Manager } }; loadSession(path: string): Promise<void> };
      const view = app.workspace.getLeavesOfType("agentic-chat-chat-view")[0]!.view as unknown as View;
      await view.service.initialize();
      const manager = view.service.sessions.sessionManager;
      const canvas = document.createElement("canvas");
      canvas.width = 1200; canvas.height = 900;
      const context = canvas.getContext("2d")!;
      const pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 77;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let j = 0; j < 3; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels.data[i + j] = seed >>> 24; }
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const data = canvas.toDataURL("image/png").split(",")[1]!;
      const originalWrite = app.vault.adapter.write.bind(app.vault.adapter);
      const originalAppend = app.vault.adapter.append.bind(app.vault.adapter);
      let maxTransfer = 0;
      app.vault.adapter.write = async (path, value, options) => { maxTransfer = Math.max(maxTransfer, value.length); return originalWrite(path, value, options); };
      app.vault.adapter.append = async (path, value, options) => { maxTransfer = Math.max(maxTransfer, value.length); return originalAppend(path, value, options); };
      let info: { path: string };
      try {
        info = await manager.createSession({ provider: "openrouter", modelId: "openai/gpt-4o-mini", thinkingLevel: "off" });
        for (let i = 0; i < 3; i++) await manager.appendMessage({ role: "user", timestamp: i + 1, content: [{ type: "text", text: `原图读取测试 ${i}` }, { type: "image", mimeType: "image/png", data }] });
      } finally {
        app.vault.adapter.write = originalWrite;
        app.vault.adapter.append = originalAppend;
      }
      const sessionBytes = (await app.vault.adapter.stat(info!.path))!.size;
      await view.loadSession(info!.path);
      const restored = manager.buildSessionContext().messages;
      return { maxTransfer, sessionBytes, imageCharacters: data.length, exact: restored.length === 3 && restored.every(message => message.content.find(part => part.type === "image")?.data === data) };
    });
    expect(result.imageCharacters).toBeGreaterThan(3 * 1024 * 1024);
    expect(result.maxTransfer).toBeLessThanOrEqual(512 * 1024);
    expect(result.sessionBytes).toBeLessThan(10000);
    expect(result.exact).toBe(true);
    await browser.waitUntil(async () => browser.execute(() => Array.from(document.querySelectorAll<HTMLImageElement>(".agentic-chat-user img")).filter(image => image.complete && image.naturalWidth === 1200).length >= 3), { timeout: 20000 });
  });
});
