import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { mergeSettings } from "../src/settings-schema";
import { createVaultTools } from "../src/tools/vault-tools";
import { ReadMemo } from "../src/vault/read-memo";
import { normalizeVaultPath } from "../src/vault/path";
import { FakeVault } from "./helpers/fake-vault";
import { AZHEN_KNOWLEDGE_MCP_ENDPOINT } from "../src/agent/azhen-knowledge-policy";
import { createMcpServerSettings } from "../src/mcp/settings";

async function fixture() {
  const vault = new FakeVault();
  const file = await vault.create("日记/今天.md", "first\nlast");
  const app = { vault } as unknown as App;
  const tools = createVaultTools(app, () => false, new ReadMemo());
  const call = (name: string, args: unknown) => tools.find(t => t.name === name)!.execute("call", args);
  return { vault, file, call };
}

describe("local knowledge safety witness", () => {
  it("new installs default local while existing Knowledge config keeps cloud", () => {
    expect(mergeSettings(null)).toHaveProperty("knowledgeMode", "local");
    const server = createMcpServerSettings("knowledge", "Knowledge", AZHEN_KNOWLEDGE_MCP_ENDPOINT);
    expect(mergeSettings({ mcp: { enabled: true, servers: [server], proxyUrl: "", noProxy: "" } }))
      .toHaveProperty("knowledgeMode", "cloud");
  });
  it("creation never overwrites an existing diary", async () => {
    const f = await fixture();
    await expect(f.call("write", { path: f.file.path, content: "lost" })).rejects.toThrow();
    expect(await f.vault.cachedRead(f.file)).toBe("first\nlast");
  });
  it("one failed replacement prevents all replacements", async () => {
    const f = await fixture();
    await f.call("read", { path: f.file.path });
    await expect(f.call("edit", { path: f.file.path, edits: [
      { oldText: "first", newText: "changed" }, { oldText: "missing", newText: "new" },
    ] })).rejects.toThrow();
    expect(await f.vault.cachedRead(f.file)).toBe("first\nlast");
  });
  it("detects external changes even when the selected fragment still matches", async () => {
    const f = await fixture();
    await f.call("read", { path: f.file.path });
    await f.vault.modify(f.file, "first\nsyncthing");
    await expect(f.call("edit", { path: f.file.path, edits: [{ oldText: "first", newText: "changed" }] }))
      .rejects.toThrow(/changed|conflict/i);
    expect(await f.vault.cachedRead(f.file)).toBe("first\nsyncthing");
  });
  it("re-reading after Syncthing returns new text and permits an exact edit", async () => {
    const f = await fixture();
    await f.call("read", { path: f.file.path });
    await f.vault.modify(f.file, "first\nsyncthing");
    const read = await f.call("read", { path: f.file.path });
    expect(JSON.stringify(read)).toContain("syncthing");
    await f.call("edit", { path: f.file.path, edits: [{ oldText: "syncthing", newText: "confirmed" }] });
    expect(await f.vault.cachedRead(f.file)).toBe("first\nconfirmed");
  });
  it.each(["C:\\outside.md", "C:outside.md", "file:///outside.md", "../outside.md", "\\\\host\\outside.md", "note.md\u0000"])
    ("rejects non-Vault path %s", path => expect(() => normalizeVaultPath(path)).toThrow());
});
