import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { ObsidianSessionManager } from "../src/session/session-manager";
import { MemoryAdapter } from "./helpers/memory-adapter";

const defaults = { provider: "openrouter", modelId: "fixture/vision", thinkingLevel: "off" as const };
const data = "QUJD".repeat(800_000);
function message(): AgentMessage {
  return { role: "user", timestamp: 1, content: [{ type: "text", text: "识别原图文字" }, { type: "image", mimeType: "image/png", data }] } as AgentMessage;
}

describe("lossless image session persistence on the mobile bridge", () => {
  it("keeps every native write bounded and restores original image data after restart", async () => {
    const adapter = new MemoryAdapter();
    const max = 1024 * 1024;
    const write = adapter.write.bind(adapter), append = adapter.append.bind(adapter);
    adapter.write = async (path, text) => { expect(text.length).toBeLessThanOrEqual(max); return write(path, text); };
    adapter.append = async (path, text) => { expect(text.length).toBeLessThanOrEqual(max); return append(path, text); };
    const manager = new ObsidianSessionManager(adapter.asDataAdapter(), "sessions", "vault:test");
    const info = await manager.createSession(defaults);
    await manager.appendMessage(message());
    await manager.appendMessage(message());
    await manager.rewriteMessages([message(), message()]);
    expect(adapter.files.get(info.path)!.length).toBeLessThan(10_000);
    const restored = new ObsidianSessionManager(adapter.asDataAdapter(), "sessions", "vault:test");
    await restored.loadSession(info.path);
    expect(restored.buildSessionContext().messages).toEqual([message(), message()]);
  });

  it("does not read an oversized legacy file through the native bridge while listing", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set("sessions/legacy.jsonl", " ".repeat(5 * 1024 * 1024));
    let read = false;
    adapter.read = async () => { read = true; throw new Error("native process would run out of memory"); };
    const manager = new ObsidianSessionManager(adapter.asDataAdapter(), "sessions", "vault:test");
    expect(await manager.listSessions()).toEqual([]);
    expect(read).toBe(false);
  });
});
