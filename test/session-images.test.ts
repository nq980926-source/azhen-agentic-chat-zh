import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { ObsidianSessionManager } from "../src/session/session-manager";
import { MemoryAdapter } from "./helpers/memory-adapter";
import { SessionImageStore } from "../src/session/image-store";
import { assertMobileRequestBody } from "../src/llm/openai-compatible-request";

const defaults = { provider: "openrouter", modelId: "fixture/vision", thinkingLevel: "off" as const };
const data = "QUJD".repeat(800_000);
function message(): AgentMessage {
  return { role: "user", timestamp: 1, content: [{ type: "text", text: "识别原图文字" }, { type: "image", mimeType: "image/png", data }] } as AgentMessage;
}

describe("lossless image session persistence on the mobile bridge", () => {
  it("rejects oversized mobile network requests before the native call without silently resizing", () => {
    expect(() => assertMobileRequestBody("a".repeat(16 * 1024 * 1024 + 1), true)).toThrow("分批");
    expect(() => assertMobileRequestBody("a".repeat(16 * 1024 * 1024), true)).not.toThrow();
    expect(() => assertMobileRequestBody("a".repeat(17 * 1024 * 1024), false)).not.toThrow();
  });

  it("deduplicates repeated images and detects a damaged chunk instead of losing image data silently", async () => {
    const adapter = new MemoryAdapter();
    const store = new SessionImageStore(adapter.asDataAdapter(), "sessions/media");
    const encoded = await store.encode(message());
    const count = adapter.files.size;
    expect(await store.encode(message())).toEqual(encoded);
    expect(adapter.files.size).toBe(count);
    const chunk = [...adapter.files.keys()].find(path => path.endsWith(".0.b64"))!;
    adapter.files.set(chunk, "AAAA");
    await expect(store.decode(encoded)).rejects.toThrow("分块不完整");
  });

  it("leaves the original transcript unchanged when an image cannot be saved", async () => {
    const adapter = new MemoryAdapter();
    const manager = new ObsidianSessionManager(adapter.asDataAdapter(), "sessions", "vault:test");
    const info = await manager.createSession(defaults);
    const before = adapter.files.get(info.path);
    const write = adapter.write.bind(adapter);
    adapter.write = async (path, content) => { if (path.endsWith(".b64")) throw new Error("disk full"); return write(path, content); };
    await expect(manager.appendMessage(message())).rejects.toThrow("disk full");
    expect(adapter.files.get(info.path)).toBe(before);
    expect(manager.buildSessionContext().messages).toEqual([]);
  });
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
