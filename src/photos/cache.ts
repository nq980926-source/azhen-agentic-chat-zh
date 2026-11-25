import { PhotoClient, PhotoError } from "./client";
interface Entry { blob: Blob; used: number; references: number; url?: string }
export interface PhotoHandle { url: string; release(): void }
/** Private display cache: memory only, 40 MiB total, 5 minute idle TTL, max two reads. */
export class PhotoCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Entry>>();
  private controllers = new Set<AbortController>();
  private urls = new Set<string>();
  private cleared = new Set<(reload: boolean) => void>();
  private disposed = false;
  private generation = 0;
  private handles = 0;
  private activeReads = 0;
  private waiting: Array<() => void> = [];
  constructor(private client: PhotoClient, private limit = 40 * 1024 * 1024, private ttl = 5 * 60000, private now: () => number = Date.now) {}
  get closed(): boolean { return this.disposed; }
  onClear(callback: (reload: boolean) => void): () => void { this.cleared.add(callback); return () => this.cleared.delete(callback); }
  private evict(): void { for (const [id, entry] of this.entries) if (!entry.references && this.now() - entry.used >= this.ttl) this.entries.delete(id); }
  get byteSize(): number { this.evict(); return [...this.entries.values()].reduce((n, e) => n + e.blob.size, 0); }
  async acquire(id: string, signal?: AbortSignal): Promise<PhotoHandle> {
    if (this.disposed || signal?.aborted) throw new PhotoError("cancelled");
    this.client.ready(); this.evict();
    const key = this.client.scope + "|" + id; const generation = this.generation;
    let entry = this.entries.get(key);
    if (!entry) {
      let pending = this.pending.get(key);
      if (!pending) {
        if (this.pending.size >= 32) throw new PhotoError("busy_use_retry");
        const controller = new AbortController(); this.controllers.add(controller);
        pending = (async () => {
          if (this.activeReads >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
          this.activeReads++;
          try {
          if (controller.signal.aborted || this.disposed || generation !== this.generation) throw new PhotoError("cancelled");
          let data;
          try { data = await this.client.read(id, controller.signal); }
          catch (error) {
            if (!(error instanceof PhotoError) || error.code !== "read_failed" || ![401, 403].includes(error.status)) throw error;
            data = await this.client.read(id, controller.signal); // One fresh grant, never infinite retry.
          }
          if (this.disposed || generation !== this.generation) throw new PhotoError("cancelled");
          for (const [oldKey, old] of this.entries) {
            if (this.byteSize + data.bytes.length <= this.limit) break;
            if (!old.references) this.entries.delete(oldKey);
          }
          if (this.byteSize + data.bytes.length > this.limit) throw new PhotoError("display_cache_full");
          const created = { blob: new Blob([data.bytes.slice().buffer], { type: data.mime }), references: 0, used: this.now() };
          this.entries.set(key, created); return created;
          } finally { this.activeReads--; this.waiting.shift()?.(); }
        })().finally(() => { if (generation === this.generation) this.pending.delete(key); this.controllers.delete(controller); });
        this.pending.set(key, pending);
      }
      entry = await pending;
    }
    if (this.disposed || generation !== this.generation || signal?.aborted) throw new PhotoError("cancelled");
    if (this.handles >= 32) throw new PhotoError("display_limit_use_retry");
    const url = entry.url ?? URL.createObjectURL(entry.blob); entry.url = url; this.urls.add(url); entry.references++; this.handles++; entry.used = this.now();
    let released = false;
    return { url, release: () => { if (released) return; released = true; entry.references--; this.handles--; if (!entry.references) { if (this.urls.has(url)) URL.revokeObjectURL(url); this.urls.delete(url); entry.url = undefined; } entry.used = this.now(); this.evict(); } };
  }
  clear(reload = false): void { this.generation++; for (const c of this.controllers) c.abort(); this.controllers.clear(); for (const u of this.urls) URL.revokeObjectURL(u); this.urls.clear(); this.entries.clear(); this.pending.clear(); for (const callback of this.cleared) callback(reload); }
  close(): void { this.disposed = true; this.clear(); this.cleared.clear(); }
}
