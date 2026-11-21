import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "obsidian";
import { createVaultTools } from "../src/tools/vault-tools";
import { ReadMemo } from "../src/vault/read-memo";
import { FakeApp } from "./helpers/fake-vault";
import { assertPhysicalVaultPath } from "../src/vault/physical-boundary";

const temporary: string[] = [];
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const app = new FakeApp();
  Object.assign(app.vault, { getFiles: () => app.vault.getMarkdownFiles(), getFileByPath: (path: string) => app.vault.getAbstractFileByPath(path), getFolderByPath: (path: string) => app.vault.getAbstractFileByPath(path) });
  const tools = createVaultTools(app as unknown as App, () => false, new ReadMemo());
  const call = (name: string, args: unknown) => tools.find(t => t.name === name)!.execute("files", args);
  return { app, call };
}
describe("reliable current-device Vault operations", () => {
  it("creates, searches names/content, reads and appends to the exact matching path", async () => {
    const { app, call } = await fixture();
    await call("write", { path: "教学/第一课.md", content: "演奏练习\n原文" });
    await call("write", { path: "日记/第一课.md", content: "同名不能误改" });
    expect(JSON.stringify(await call("vault_inspect", { action: "search", query: "演奏", kind: "content" }))).toContain("教学/第一课.md");
    expect(JSON.stringify(await call("vault_inspect", { action: "search", query: "第一课", kind: "files" }))).toContain("日记/第一课.md");
    await call("read", { path: "教学/第一课.md" });
    await call("edit", { path: "教学/第一课.md", edits: [{ oldText: "原文", newText: "原文\n续篇" }] });
    expect(await app.vault.adapter.read("教学/第一课.md")).toBe("演奏练习\n原文\n续篇");
    expect(await app.vault.adapter.read("日记/第一课.md")).toBe("同名不能误改");
  });
  it("requires a current complete read for explicit whole-file replacement", async () => {
    const { app, call } = await fixture(); await call("write", { path: "日记.md", content: "one\ntwo\nthree" });
    await expect(call("write", { path: "日记.md", content: "new", overwrite: true })).rejects.toThrow(/Read/);
    await call("read", { path: "日记.md", startLine: 2, endLine: 2 });
    await expect(call("write", { path: "日记.md", content: "new", overwrite: true })).rejects.toThrow(/complete/);
    await call("read", { path: "日记.md" });
    await call("write", { path: "日记.md", content: "explicit", overwrite: true });
    expect(await app.vault.adapter.read("日记.md")).toBe("explicit");
  });
  it("checks the version inside the atomic write transform", async () => {
    const { app, call } = await fixture(); await call("write", { path: "日记.md", content: "old" });
    await call("read", { path: "日记.md" });
    const original = app.vault.process.bind(app.vault);
    app.vault.process = async (file, transform) => { await app.vault.modify(file, "external"); return original(file, transform); };
    await expect(call("write", { path: "日记.md", content: "lost", overwrite: true })).rejects.toThrow(/changed/);
    expect(await app.vault.adapter.read("日记.md")).toBe("external");
  });
  it("does not report a successful creation after an I/O failure", async () => {
    const { app, call } = await fixture(); app.vault.create = vi.fn(async () => { throw new Error("disk full"); });
    await expect(call("write", { path: "new.md", content: "text" })).rejects.toThrow("disk full");
  });
  it("refuses permanent removal when both trash paths fail", async () => {
    const { app, call } = await fixture(); app.vault.addDiskOnlyFile("unindexed.md", "keep");
    const remove = vi.fn(); Object.assign(app.vault.adapter, { stat: async () => ({ type: "file", mtime: 0, ctime: 0, size: 4 }), trashSystem: async () => false,
      trashLocal: async () => { throw new Error("trash unavailable"); }, remove });
    await expect(call("delete", { path: "unindexed.md" })).rejects.toThrow(/refusing permanent/);
    expect(remove).not.toHaveBeenCalled(); expect(await app.vault.adapter.read("unindexed.md")).toBe("keep");
  });
  it("checks full content before frontmatter changes", async () => {
    const { app, call } = await fixture(); const file = await app.vault.create("note.md", "---\nstatus: old\n---\nbody");
    await call("read", { path: "note.md" }); await app.vault.modify(file, "---\nstatus: old\n---\nexternal body");
    await expect(call("set_properties", { path: "note.md", properties: { status: "new" } })).rejects.toThrow(/changed/);
    expect(await app.vault.adapter.read("note.md")).toContain("status: old");
  });
  it("refuses stale locally registered tools after a mode switch", async () => {
    const app = new FakeApp(); let current = true;
    const tools = createVaultTools(app as unknown as App, () => false, new ReadMemo(), { canExecute: () => current });
    current = false;
    await expect(tools.find(t => t.name === "write")!.execute("old", { path: "no.md", content: "no" })).rejects.toThrow(/scope changed/);
    expect(await app.vault.adapter.exists("no.md")).toBe(false);
  });
  it("rejects existing desktop junctions outside Vault, including a new destination below one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "azhen-boundary-")); temporary.push(dir);
    const root = join(dir, "vault"), outside = join(dir, "outside"); await mkdir(root); await mkdir(outside);
    await writeFile(join(outside, "private.md"), "private");
    await symlink(outside, join(root, "alias"), "junction");
    const app = { vault: { adapter: { getBasePath: () => root, getFullPath: (path: string) => join(root, path) } } } as unknown as App;
    await expect(assertPhysicalVaultPath(app, "alias/private.md")).rejects.toThrow(/outside/);
    await expect(assertPhysicalVaultPath(app, "alias/new/diary.md")).rejects.toThrow(/outside/);
    await expect(assertPhysicalVaultPath(app, "new/diary.md")).resolves.toBeUndefined();
  });
});
