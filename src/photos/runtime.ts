import { Notice, TFile, requireApiVersion, type Plugin } from "obsidian";
import { PhotoClient, PhotoError, type PhotoSettings } from "./client";
import { validatePhotoSelection } from "./limits";
import { readLocalImage } from "../ui/local-images";
import { PhotoTasks, type PhotoResult, type PhotoSource } from "./tasks";
import { PhotoCache } from "./cache";
import { photoApproval, PhotoProgressModal, PhotoReceiptModal } from "./modals";
import { registerPhotoRenderer } from "./renderer";
import { registerPhotoEditor } from "./editor";
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
  private noteWrites = 0;
  private disposed = false;
  private pickers = new Set<HTMLInputElement>();
  constructor(private plugin: Host) {
    this.client = new PhotoClient(() => ({ ...plugin.settings.photos, enabled: this.enabled(), tokenSecretId: this.deviceSecretId() }), () => requireApiVersion("1.11.5") ? this.sessionToken || plugin.app.secretStorage?.getSecret(this.deviceSecretId()) || "" : "");
    this.tasks = new PhotoTasks(this.client, { load: () => plugin.app.loadLocalStorage("agentic-chat-photo-tasks-v1") as unknown, save: value => plugin.app.saveLocalStorage("agentic-chat-photo-tasks-v1", value) }, () => this.permitted());
    this.cache = new PhotoCache(this.client);
    registerPhotoRenderer(plugin, this.cache);
    registerPhotoEditor(plugin, this.cache);
    plugin.registerInterval(window.setInterval(() => { void this.cache.byteSize; }, 60000));
    plugin.register(() => { this.disposed = true; this.sessionToken = ""; this.tasks.close(); this.cache.close(); for (const picker of this.pickers) picker.remove(); this.pickers.clear(); });
    plugin.addCommand({ id: "save-note-photos", name: "为当前笔记选择并保存照片", checkCallback: checking => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "md" || !this.permitted()) return false;
      if (!checking) this.pickForNote(file.path);
      return true;
    } });
    plugin.addRibbonIcon("image-plus", "为当前笔记保存照片", () => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension === "md") this.pickForNote(file.path);
      else new Notice("请先打开要关联照片的本地 Markdown 笔记");
    });
  }
  deviceSecretId(): string {
    const value: unknown = this.plugin.app.loadLocalStorage("agentic-chat-photos-device-key-v1");
    return typeof value === "string" && /^agentic-chat-photos-[a-f0-9-]{36}$/.test(value) ? value : this.plugin.settings.photos.tokenSecretId;
  }
  enabled(): boolean {
    const value: unknown = this.plugin.app.loadLocalStorage("agentic-chat-photos-device-enabled-v1");
    return typeof value === "boolean" ? value : this.plugin.settings.photos.enabled;
  }
  setEnabled(value: boolean): void { this.plugin.app.saveLocalStorage("agentic-chat-photos-device-enabled-v1", value); this.changed(); }
  storeDeviceToken(token: string): void {
    if (!requireApiVersion("1.11.5")) throw new PhotoError("secret_storage_upgrade_required");
    if (!/^azp_[A-Za-z0-9_-]{43}$/.test(token)) throw new PhotoError("invalid_pairing_response");
    const existing = this.deviceSecretId();
    const key = /^agentic-chat-photos-[a-f0-9-]{36}$/.test(existing) ? existing : `agentic-chat-photos-${crypto.randomUUID()}`;
    this.plugin.app.secretStorage.setSecret(key, token);
    if (this.plugin.app.secretStorage.getSecret(key) !== token) throw new PhotoError("device_storage_failed");
    this.plugin.app.saveLocalStorage("agentic-chat-photos-device-key-v1", key);
    this.sessionToken = ""; this.changed();
  }
  pickForNote(path: string): void {
    if (!this.permitted()) { new Notice("请切换到本地知识库的可编辑模式"); return; }
    const target = this.plugin.app.vault.getFileByPath(path);
    if (!(target instanceof TFile) || target.extension !== "md") { new Notice("目标本地笔记已改变，请重新选择"); return; }
    if (!this.enabled() || !this.plugin.app.secretStorage?.getSecret(this.deviceSecretId())) {
      new Notice("请先在照片设置中连接此设备并启用照片服务"); return;
    }
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "image/png,image/jpeg,image/webp,image/gif"; picker.multiple = true; picker.hidden = true;
    document.body.appendChild(picker);
    this.pickers.add(picker);
    const remove = () => { picker.value = ""; picker.remove(); this.pickers.delete(picker); };
    picker.addEventListener("cancel", remove, { once: true });
    picker.addEventListener("change", () => {
      const files = Array.from(picker.files ?? []); remove();
      void (async () => {
        if (!files.length) return;
        try { validatePhotoSelection(files); } catch (error) { new Notice((error as Error).message); return; }
        const images = await Promise.all(files.map(readLocalImage));
        await this.openSave({ key: `note:${crypto.randomUUID()}`, images, target: path }, () => this.permitted() && target.path === path && this.plugin.app.vault.getFileByPath(path) === target);
      })().catch(() => new Notice("照片读取失败；没有自动上传，请核对文件格式和大小"));
    }, { once: true });
    picker.click();
  }
  permitted(): boolean { return !this.disposed && this.plugin.settings.knowledgeMode === "local" && this.plugin.settings.mode !== "plan" && !this.plugin.knowledgeTransition.active; }
  get active(): boolean { return this.tasks.active || this.noteWrites > 0; }
  setSessionToken(value: string): void { this.sessionToken = value; this.cache.clear(true); }
  changed(): void { this.tasks.cancel(); this.cache.clear(true); }
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
      const references = results.filter(result => result.status === "confirmed").map(result => result.reference!).join("\n\n");
      let linked = false;
      if (valid() && source.target && references) {
        try { await this.insert(source.target, references); linked = true; new Notice("照片已保存并关联本地笔记"); }
        catch { new Notice("照片已确认保存，但笔记关联失败；回执中的稳定引用已保留，可重试插入"); }
      }
      if (valid()) new PhotoReceiptModal(this.plugin.app, results, (path, refs) => this.insert(path, refs), source.target, linked, () => { void this.openSave(source, valid); }).open();
    } catch (error) { new Notice(error instanceof PhotoError ? error.message : "照片处理失败；AI 对话与本地文字未修改。"); }
  }
  async insert(input: string, references: string): Promise<void> {
    this.noteWrites++;
    try { await this.insertReferences(input, references); }
    finally { this.noteWrites--; }
  }
  private async insertReferences(input: string, references: string): Promise<void> {
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
