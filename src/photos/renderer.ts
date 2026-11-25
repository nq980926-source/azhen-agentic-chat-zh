import { MarkdownRenderChild, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import { parsePhotoReference, PhotoError } from "./client";
import type { PhotoCache, PhotoHandle } from "./cache";

export class PhotoRenderChild extends MarkdownRenderChild {
  private controller = new AbortController();
  private handle?: PhotoHandle;
  private alive = true;
  private attempt = 0;
  private loading = false;
  constructor(container: HTMLElement, private cache: PhotoCache, private id: string, private caption: string, private chat = false, private detached?: () => void) { super(container); }
  onload(): void {
    this.alive = true; this.controller = new AbortController();
    this.register(this.cache.onClear(reload => {
      this.attempt++; this.loading = false; this.controller.abort(); this.controller = new AbortController();
      this.handle?.release(); this.handle = undefined;
      if (this.cache.closed) this.unload();
      else if (this.alive) {
        this.placeholder("cache_cleared_use_retry");
        const rect = this.containerEl.getBoundingClientRect();
        if (reload && this.containerEl.isConnected && rect.width > 0 && rect.height > 0 && rect.bottom >= -200 && rect.top <= (this.containerEl.ownerDocument.defaultView?.innerHeight ?? 0) + 200) void this.loadPhoto();
      }
    }));
    // Chat re-renders can detach nodes before their shared component unloads.
    // Native mobile previews can load a component before attaching its fragment.
    let mounted = false;
    const visibility = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!mounted || !this.alive) continue;
        if (entry.isIntersecting) {
          if (this.controller.signal.aborted) this.controller = new AbortController();
          if (!this.handle && !this.loading) void this.loadPhoto();
        } else if (this.handle || this.loading) {
          this.containerEl.style.minHeight = `${Math.ceil(this.containerEl.getBoundingClientRect().height)}px`;
          this.attempt++; this.loading = false; this.controller.abort(); this.handle?.release(); this.handle = undefined;
          this.containerEl.empty(); this.containerEl.createSpan({ text: "照片在可见时自动加载" });
        }
      }
    }, { rootMargin: "200px" });
    this.register(() => visibility?.disconnect());
    const connected = () => {
      if (!mounted && this.containerEl.isConnected) {
        mounted = true; this.controller = new AbortController();
        if (visibility) visibility.observe(this.containerEl); else void this.loadPhoto();
      }
      else if (mounted && !this.containerEl.isConnected) {
        mounted = false; this.attempt++; this.loading = false; visibility?.unobserve(this.containerEl); this.controller.abort(); this.handle?.release(); this.handle = undefined;
        // Native previews can park and reconnect their DOM when changing mode.
        // Their context owns unloading. Chat replaces old DOM permanently.
        if (this.chat) this.unload();
      }
    };
    const observer = new MutationObserver(connected);
    observer.observe(this.containerEl.ownerDocument.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
    connected();
  }
  private async loadPhoto(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const attempt = ++this.attempt;
    this.containerEl.empty(); this.containerEl.createSpan({ text: "照片加载中…" });
    try {
      const handle = await this.cache.acquire(this.id, this.controller.signal);
      if (!this.alive || !this.containerEl.isConnected || attempt !== this.attempt) { handle.release(); return; }
      this.handle?.release(); this.handle = handle;
      this.containerEl.empty();
      const image = this.containerEl.createEl("img", { cls: "azhen-photo-image", attr: { src: handle.url, alt: this.caption, loading: "lazy", referrerpolicy: "no-referrer" } });
      image.addEventListener("error", () => { this.handle?.release(); this.handle = undefined; this.placeholder("image_decode_failed"); }, { once: true });
    } catch (error) { if (this.alive && attempt === this.attempt && !this.controller.signal.aborted) this.placeholder(error instanceof PhotoError ? error.code : "unavailable"); }
    finally { if (attempt === this.attempt) this.loading = false; }
  }
  private placeholder(reason: string): void {
    this.containerEl.empty();
    this.containerEl.createSpan({ text: `${this.caption || "照片"}：暂不可用（${reason}）` });
    const retry = this.containerEl.createEl("button", { text: "重试", attr: { type: "button" } });
    retry.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); void this.loadPhoto(); });
  }
  onunload(): void { this.alive = false; this.attempt++; this.controller.abort(); this.handle?.release(); this.handle = undefined; this.detached?.(); }
}

const owners = new WeakMap<HTMLElement, PhotoRenderChild>();
export function renderPhotos(element: HTMLElement, context: Pick<MarkdownPostProcessorContext, "addChild"> & Partial<Pick<MarkdownPostProcessorContext, "sourcePath">>, cache: PhotoCache): void {
  for (const image of Array.from(element.querySelectorAll<HTMLImageElement>('img[src^="azhen-photo://"]'))) {
    const id = parsePhotoReference(image.getAttribute("src") ?? "");
    const container = image.ownerDocument.createElement("span"); container.className = "azhen-photo";
    container.setAttribute("data-photo-id", id ?? "invalid");
    const caption = image.getAttribute("alt") ?? "照片";
    container.setAttribute("data-photo-caption", caption);
    image.replaceWith(container);
    if (!id) container.textContent = "照片引用无效；原始笔记未修改";
  }
  // Obsidian may reuse processed sections across Reading/Live Preview switches.
  for (const container of Array.from(element.querySelectorAll<HTMLElement>(".azhen-photo[data-photo-id]"))) {
    const id = parsePhotoReference(`azhen-photo://v1/${container.dataset.photoId ?? ""}`);
    if (!id || owners.has(container)) continue;
    const child = new PhotoRenderChild(container, cache, id, container.dataset.photoCaption ?? "照片", !context.sourcePath, () => owners.delete(container));
    owners.set(container, child); context.addChild(child);
  }
}
export function registerPhotoRenderer(plugin: Plugin, cache: PhotoCache): void { plugin.registerMarkdownPostProcessor((element, context) => renderPhotos(element, context, cache)); }
