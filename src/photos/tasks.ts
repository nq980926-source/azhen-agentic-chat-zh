import { bytesFromBase64, contentMd5, sha256 } from "./digests";
import { sha256Hex } from "../utils/sha256";
import { MAX_PHOTO_BYTES, PHOTO_MIMES, PhotoClient, PhotoError, photoReference, UUID, type Intent, type UploadParameters } from "./client";

export interface PhotoImage { name: string; data: string; mimeType: string; size: number }
export interface PhotoSource { key: string; images: PhotoImage[]; purpose?: string; target?: string }
export type PhotoApproval = (source: PhotoSource, signal?: AbortSignal) => Promise<number[] | null>;
export interface PhotoTask { operationId: string; batchId: string; fingerprint: string; scope: string; state: "pending" | "unknown" | "confirmed"; photoId?: string; createdAt: number }
export interface PhotoTaskStore { load(): unknown; save(tasks: PhotoTask[]): void }
export interface PhotoResult { index: number; status: "confirmed" | "failed" | "cancelled"; reference?: string; photoId?: string; operationId: string; error?: string }

function uuidFrom(value: string): string { const h = sha256Hex(value); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }
/** Only bounded task metadata, never image bytes, grants, credentials, or note bodies. No auto replay. */
export class PhotoTasks {
  private tasks: PhotoTask[];
  private busy = new Set<string>();
  private controllers = new Set<AbortController>();
  private disposed = false;
  constructor(private client: PhotoClient, private store: PhotoTaskStore, private permitted: () => boolean) {
    const raw = store.load();
    this.tasks = Array.isArray(raw) ? raw.filter((t: PhotoTask) => t && UUID.test(t.operationId) && UUID.test(t.batchId) && /^[a-f0-9]{64}$/.test(t.fingerprint) && typeof t.scope === "string" && ["pending", "unknown", "confirmed"].includes(t.state) && (!t.photoId || UUID.test(t.photoId)) && Number.isFinite(t.createdAt) && t.createdAt > Date.now() - 30 * 86400000).slice(-100).map((t: PhotoTask) => ({ operationId: t.operationId, batchId: t.batchId, fingerprint: t.fingerprint, scope: t.scope, state: t.state === "confirmed" ? "confirmed" : "unknown", photoId: t.photoId, createdAt: t.createdAt })) : [];
  }
  get active(): boolean { return this.controllers.size > 0; }
  snapshot(): PhotoTask[] { return structuredClone(this.tasks); }
  cancel(): void { for (const c of this.controllers) c.abort(); }
  close(): void { this.disposed = true; this.cancel(); }
  private persist(): void { this.tasks = this.tasks.slice(-100); this.store.save(this.snapshot()); }
  async save(source: PhotoSource, approve: PhotoApproval, signal?: AbortSignal, valid: () => boolean = () => true): Promise<PhotoResult[]> {
    if (this.disposed || !this.permitted()) throw new PhotoError("local_mode_required");
    this.client.ready();
    if (!source.key || source.key.length > 512 || !source.images.length || source.images.length > 4 || source.images.some(i => !PHOTO_MIMES[i.mimeType] || !i.size || i.size > MAX_PHOTO_BYTES) || source.images.reduce((n, i) => n + i.size, 0) > 8 * 1024 * 1024) throw new PhotoError("selection_limit_2MiB_each_4_photos");
    const scope = this.client.scope;
    const busyKey = `${scope}|${source.key}`;
    if (this.busy.has(busyKey)) throw new PhotoError("task_already_active");
    this.busy.add(busyKey);
    const controller = new AbortController(); this.controllers.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    const alive = () => !this.disposed && !signal?.aborted && !controller.signal.aborted && this.permitted() && valid() && this.client.scope === scope;
    const validity = window.setInterval(() => { if (!alive()) controller.abort(); }, 100);
    const results: PhotoResult[] = [];
    // Copy before the approval so later draft changes cannot change what was selected.
    const selectedSource = { ...source, images: source.images.map(i => ({ ...i })) };
    try {
      if (!alive()) return [];
      const approved = await approve(selectedSource, controller.signal);
      if (!alive() || !approved?.length) return [];
      if (approved.length > source.images.length || new Set(approved).size !== approved.length || approved.some(i => !Number.isInteger(i) || i < 0 || i >= source.images.length)) throw new PhotoError("invalid_approval_selection");
      const batchId = uuidFrom(`${scope}|${source.key}|batch`);
      for (const index of approved) {
        if (!alive()) break;
        const image = selectedSource.images[index];
        const bytes = bytesFromBase64(image.data);
        if (bytes.length !== image.size) throw new PhotoError("image_source_mismatch");
        const digest = await sha256(bytes);
        const fingerprint = sha256Hex(`${scope}|${source.key}|${index}|${digest}`);
        const operationId = uuidFrom(fingerprint);
        let task = this.tasks.find(t => t.operationId === operationId);
        if (!task) {
          task = { operationId, batchId, fingerprint, scope, state: "pending", createdAt: Date.now() };
          this.tasks.push(task);
        }
        try {
          if (!alive()) break;
          if (task.state === "confirmed" && task.photoId) {
            results.push({ index, status: "confirmed", operationId, photoId: task.photoId, reference: photoReference(task.photoId) }); continue;
          }
          const retry = task.state === "unknown";
          task.state = "unknown"; this.persist(); // Durable id before authorization; no image payload is persisted.
          const params: UploadParameters = { operationId, batchId, bytes: bytes.length, mime: image.mimeType, sha256: digest, contentMd5: contentMd5(bytes), originalFilename: `chat-image-${index + 1}.${PHOTO_MIMES[image.mimeType]}` };
          let intent = await this.client.create(params, controller.signal);
          const check = (v: Intent) => {
            if (v.bytes !== params.bytes || v.mime !== params.mime || v.sha256 !== params.sha256 || (task.photoId && task.photoId !== v.photoId)) throw new PhotoError("operation_binding_mismatch");
            task.photoId = v.photoId;
          };
          check(intent);
          if (!alive()) break;
          if (intent.state !== "confirmed" && (retry || !intent.authorization)) {
            intent = await this.client.action(operationId, "complete", { outcome: "timeout" }, controller.signal); check(intent);
            if (!alive()) break;
            if (intent.state !== "confirmed") { intent = await this.client.action(operationId, "renew", {}, controller.signal); check(intent); }
          }
          if (!alive()) break;
          if (intent.state !== "confirmed") {
            await this.client.put(intent, params, bytes, controller.signal);
            if (!alive()) break;
            intent = await this.client.action(operationId, "complete", {}, controller.signal); check(intent);
          }
          if (intent.state !== "confirmed") throw new PhotoError("not_confirmed_retry_same_operation");
          task.state = "confirmed"; task.photoId = intent.photoId; this.persist();
          results.push({ index, status: "confirmed", operationId, photoId: intent.photoId, reference: photoReference(intent.photoId) });
        } catch (error) {
          results.push({ index, status: alive() ? "failed" : "cancelled", operationId, ...(task.state === "confirmed" ? { photoId: task.photoId } : {}), error: error instanceof PhotoError ? error.code : "task_state_or_transport_failed" });
        }
      }
      return results;
    } finally { window.clearInterval(validity); signal?.removeEventListener("abort", abort); this.controllers.delete(controller); this.busy.delete(busyKey); }
  }
}
