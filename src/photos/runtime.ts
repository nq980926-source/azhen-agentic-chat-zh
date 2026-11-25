import { Notice, TFile, type Plugin } from "obsidian";
import { PhotoClient, PhotoError, type PhotoSettings } from "./client";
import { PhotoTasks, type PhotoResult, type PhotoSource } from "./tasks";
import { PhotoCache } from "./cache";
import { photoApproval, PhotoProgressModal, PhotoReceiptModal } from "./modals";
import { registerPhotoRenderer } from "./renderer";
import { createVaultTools } from "../tools/vault-tools";
import { ReadMemo } from "../vault/read-memo";
import { createFileSystemDenyMatcher } from "../vault/file-system-sandbox";
import { normalizeVaultPath } from "../vault/path";
interface Host extends Plugin { settings: { photos: PhotoSettings; knowledgeMode: string; mode: string; ignoredGlobs: string }; knowledgeTransition: { active: boolean } }

export class PhotoRuntime {
  readonly client: PhotoClient;
  readonly tasks: PhotoTasks;
  readonly cache: PhotoCache;
  private sessionToken = "";
  constructor(private plugin: Host) {
    this.client = new PhotoClient(() => plugin.settings.photos, () => this.sessionToken || plugin.app.secretStorage?.getSecret(plugin.settings.photos.tokenSecretId) || "");
    this.tasks = new PhotoTasks(this.client, { load: () => plugin.app.loadLocalStorage("agentic-chat-photo-tasks-v1") as unknown, save: value => plugin.app.saveLocalStorage("agentic-chat-photo-tasks-v1", value) }, () => this.permitted());
    this.cache = new PhotoCache(this.client);
    registerPhotoRenderer(plugin, this.cache);
    plugin.registerInterval(window.setInterval(() => { void this.cache.byteSize; }, 60000));
    plugin.register(() => { this.sessionToken = ""; this.tasks.close(); this.cache.close(); });
  }
  permitted(): boolean { return this.plugin.settings.knowledgeMode === "local" && this.plugin.settings.mode !== "plan" && !this.plugin.knowledgeTransition.active; }
  get active(): boolean { return this.tasks.active; }
  setSessionToken(value: string): void { this.sessionToken = value; this.cache.clear(); }
  changed(): void { this.tasks.cancel(); this.cache.clear(); }
  save = async (source: PhotoSource, signal?: AbortSignal, valid?: () => boolean): Promise<PhotoResult[]> => {
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let progress: PhotoProgressModal | undefined;
    try {
      if (signal?.aborted) return [];
      return await this.tasks.save(source, async (images, approvalSignal) => {
        const selected = await photoApproval(this.plugin.app)(images, approvalSignal);
        if (selected?.length && !controller.signal.aborted && (!valid || valid())) { progress = new PhotoProgressModal(this.plugin.app, selected.length, abort); progress.open(); }
        return selected;
      }, controller.signal, valid);
    } finally { progress?.finish(); signal?.removeEventListener("abort", abort); }
  };
  async openSave(source: PhotoSource, valid: () => boolean): Promise<void> {
    try {
      const results = await this.save(source, undefined, valid);
      if (valid()) new PhotoReceiptModal(this.plugin.app, results, (path, refs) => this.insert(path, refs), source.target).open();
    } catch (error) { new Notice(error instanceof PhotoError ? error.message : "照片处理失败；AI 对话与本地文字未修改。"); }
  }
  async insert(input: string, references: string): Promise<void> {
    if (!this.permitted()) throw new PhotoError("local_mode_required");
    const path = normalizeVaultPath(input);
    if (!path || !path.endsWith(".md") || path.startsWith(this.plugin.app.vault.configDir + "/")) throw new PhotoError("markdown_target_required");
    const file = this.plugin.app.vault.getFileByPath(path);
    if (!(file instanceof TFile)) throw new PhotoError("existing_note_required");
    const memo = new ReadMemo();
    const tools = createVaultTools(this.plugin.app, createFileSystemDenyMatcher(this.plugin.settings.ignoredGlobs, this.plugin.app.vault.configDir), memo, { enforcePhysicalBoundary: true, canExecute: () => this.permitted() });
    const call = async (name: string, params: unknown) => tools.find(t => t.name === name)!.execute("photo-insert", params);
    await call("read", { path });
    const content = await this.plugin.app.vault.read(file); memo.assertUnchanged(path, content, true);
    const additions = references.split("\n\n").filter(r => { const id = /azhen-photo:\/\/v1\/([0-9a-f-]+)/.exec(r)?.[1]; if (!id) throw new PhotoError("invalid_reference"); return !content.includes(`azhen-photo://v1/${id}`); }).join("\n\n");
    if (!additions) return;
    if (!content) { await call("write", { path, content: additions + "\n", overwrite: true }); return; }
    let length = Math.min(content.length, 128); let tail = content.slice(-length);
    while (content.indexOf(tail) !== content.length - tail.length && length < Math.min(content.length, 2048)) { length = Math.min(content.length, length * 2); tail = content.slice(-length); }
    if (content.indexOf(tail) !== content.length - tail.length) throw new PhotoError("ambiguous_insertion_anchor");
    await call("edit", { path, edits: [{ oldText: tail, newText: tail + (content.endsWith("\n") ? "\n" : "\n\n") + additions + "\n" }] });
  }
}
