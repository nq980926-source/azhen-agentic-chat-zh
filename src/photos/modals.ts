import { Modal, Notice, Setting, type App, type ButtonComponent } from "obsidian";
import type { PhotoApproval, PhotoResult, PhotoSource } from "./tasks";
export class PhotoApprovalModal extends Modal {
  private answer: ((value: number[] | null) => void) | undefined;
  private selected = new Set<number>();
  constructor(app: App, private source: PhotoSource) { super(app); }
  request(signal?: AbortSignal): Promise<number[] | null> {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const abort = () => this.close();
      this.answer = value => { signal?.removeEventListener("abort", abort); resolve(value); };
      signal?.addEventListener("abort", abort, { once: true }); this.open();
    });
  }
  onOpen(): void {
    this.contentEl.addClass("azhen-photo-approval");
    this.setTitle("批准本次照片上传");
    this.contentEl.createEl("p", { text: `共 ${this.source.images.length} 张候选照片；仅保存你本次选中的照片至私有 COS。普通 AI 对话继续使用原流程。` });
    if (this.source.purpose) this.contentEl.createEl("p", { text: `用途：${this.source.purpose}` });
    this.contentEl.createEl("p", { text: `关联本地笔记：${this.source.target || "未指定；上传后可复制引用或插入笔记"}` });
    if (this.source.target) this.contentEl.createEl("p", { text: "批准后，确认成功的照片会自动追加到上述笔记；不覆盖正文。" });
    const count = this.contentEl.createEl("p", { cls: "azhen-photo-selected-count", text: "已选择 0 张" });
    let submit: ButtonComponent;
    this.source.images.forEach((image, index) => {
      const row = new Setting(this.contentEl).setName(`照片 ${index + 1} · ${(image.size / 1024).toFixed(0)} KiB`);
      row.settingEl.addClass("azhen-photo-choice");
      row.descEl.createEl("img", { attr: { src: `data:${image.mimeType};base64,${image.data}`, alt: `照片 ${index + 1}` } });
      row.addToggle(toggle => toggle.setValue(false).setTooltip(`批准照片 ${index + 1}`).onChange(value => {
        if (value) this.selected.add(index); else this.selected.delete(index);
        count.setText(`已选择 ${this.selected.size} 张`); submit.setDisabled(this.selected.size === 0);
      }));
    });
    new Setting(this.contentEl).addButton(b => b.setButtonText("取消").onClick(() => this.close())).addButton(b => {
      submit = b; b.setButtonText("确认上传").setCta().setDisabled(true).onClick(() => { if (!this.selected.size) return; const answer = this.answer; this.answer = undefined; answer?.([...this.selected].sort((a, b) => a - b)); this.close(); });
    });
  }
  onClose(): void { const answer = this.answer; this.answer = undefined; answer?.(null); this.contentEl.empty(); }
}
export function photoApproval(app: App): PhotoApproval { return (source, signal) => new PhotoApprovalModal(app, source).request(signal); }

export class PhotoProgressModal extends Modal {
  private finished = false;
  constructor(app: App, private count: number, private cancel: () => void) { super(app); }
  onOpen(): void {
    this.setTitle("保存已批准的照片");
    this.contentEl.createEl("p", { text: `正在申请授权并保存本次批准的 ${this.count} 张照片。可取消剩余请求；已经发出的上传可能已到达 COS，重试会核对原操作，不删除对象。` });
    new Setting(this.contentEl).addButton(b => b.setButtonText("取消剩余上传").onClick(() => this.close()));
  }
  finish(): void { this.finished = true; this.close(); }
  onClose(): void { if (!this.finished) this.cancel(); this.contentEl.empty(); }
}

/** Small receipt, not an album: stable references remain available if note insertion fails. */
export class PhotoReceiptModal extends Modal {
  constructor(app: App, private results: PhotoResult[], private insert: (path: string, refs: string) => Promise<void>, private target = "", private linked = false, private retry?: () => void) { super(app); }
  onOpen(): void {
    this.setTitle("照片保存结果");
    const refs = this.results.filter(r => r.status === "confirmed").map(r => r.reference!).join("\n\n");
    this.contentEl.createEl("p", { text: this.results.length ? this.results.map(r => `照片 ${r.index + 1}：${r.status === "confirmed" ? "保存已确认" : `${r.status}（${r.error ?? "中断"}）`}`).join("；") : "已取消，未继续上传。" });
    if (this.retry && this.results.some(result => result.status !== "confirmed")) new Setting(this.contentEl).addButton(b => b.setButtonText("重新选择并批准未完成照片").onClick(() => { this.close(); this.retry?.(); }));
    if (!refs) return;
    if (this.linked) {
      this.contentEl.createEl("p", { text: `已关联本地笔记：${this.target}。以后打开笔记会自动显示配图。` });
      new Setting(this.contentEl).addButton(b => b.setButtonText("打开笔记").setCta().onClick(() => { void this.app.workspace.openLinkText(this.target, ""); this.close(); }));
      return;
    }
    this.contentEl.createEl("textarea", { cls: "azhen-photo-references", attr: { readonly: "", "aria-label": "稳定照片引用" } }).value = refs;
    new Setting(this.contentEl).addButton(b => b.setButtonText("复制引用").onClick(() => { void navigator.clipboard.writeText(refs).then(() => new Notice("照片引用已复制"), () => new Notice("无法访问剪贴板，可选择上方文本复制")); }));
    new Setting(this.contentEl).setName("目标本地笔记完整路径").setDesc("只向已有 Markdown 追加引用；可重试，不覆盖正文。AI 写日记可直接使用这些引用。").addText(t => t.setPlaceholder("日记/2026-11-24.md").setValue(this.target).onChange(v => { this.target = v; }));
    const state = this.contentEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.contentEl).addButton(b => b.setButtonText("插入本地笔记").onClick(async () => {
      b.setDisabled(true); state.setText("正在检查目标并插入…");
      try { await this.insert(this.target, refs); state.setText("本地笔记插入成功"); }
      catch { state.setText("插入失败：请核对完整路径、当前本地模式、文件权限或外部修改。已上传照片及上方引用保留，可重试；未删除 COS 对象。"); }
      finally { b.setDisabled(false); }
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}
