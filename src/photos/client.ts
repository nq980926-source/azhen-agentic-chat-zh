import { sha256 } from "./digests";
import { MAX_PHOTO_BYTES } from "./limits";
export { MAX_PHOTO_BYTES, MAX_PHOTO_BATCH_BYTES, MAX_PHOTO_COUNT } from "./limits";

export interface PhotoSettings { enabled: boolean; endpoint: string; tokenSecretId: string }
export const DEFAULT_PHOTOS: PhotoSettings = { enabled: false, endpoint: "https://106.55.92.40/photos/v1/", tokenSecretId: "agentic-chat-photos-token" };
// Production writes are pinned; the previously approved isolated run is read-only.
export const PHOTO_PREFIX = "private-photos/v1/";
export const LEGACY_PHOTO_PREFIX = "isolated-test/s2-05/492d2883-a19e-4929-bedd-86db673b7f51/";
export const PHOTO_HOST = "azhen-photos-1301105804.cos.ap-guangzhou.myqcloud.com";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PHOTO_MIMES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export class PhotoError extends Error { constructor(readonly code: string, readonly status = 0) { super(`照片服务：${code}${status ? ` (${status})` : ""}`); } }
export function photoId(value: string): string { if (!UUID.test(value)) throw new PhotoError("invalid_photo_id"); return value; }
export function photoReference(id: string, caption = "照片"): string { return `![${caption.replaceAll("[", " ").replaceAll("]", " ").replace(/[\\\r\n]/g, " ").slice(0, 120)}](azhen-photo://v1/${photoId(id)})`; }
export function parsePhotoReference(value: string): string | null { const m = /^azhen-photo:\/\/v1\/([0-9a-f-]+)$/.exec(value); return m && UUID.test(m[1]) ? m[1] : null; }
export function healPhotos(value: unknown): PhotoSettings {
  const v = value as Partial<PhotoSettings> | undefined;
  return { enabled: v?.enabled === true, endpoint: DEFAULT_PHOTOS.endpoint, tokenSecretId: typeof v?.tokenSecretId === "string" && /^[a-z0-9-]{1,100}$/.test(v.tokenSecretId) ? v.tokenSecretId : DEFAULT_PHOTOS.tokenSecretId };
}
export interface Grant { method: "GET" | "PUT"; url: string; headers?: Record<string, string>; expiresAt: number; serverTime: number }
export interface Intent { operationId: string; photoId: string; state: string; bytes: number; mime: string; sha256: string; authorization?: Grant }
export interface UploadParameters { operationId: string; batchId: string; bytes: number; mime: string; sha256: string; contentMd5: string; originalFilename: string }
export interface WireResponse { status: number; body: ArrayBuffer }
export type PhotoWire = (url: string, method: string, headers: Record<string, string>, body: ArrayBuffer | undefined, signal: AbortSignal | undefined, limit: number) => Promise<WireResponse>;

/** No redirect, ambient credentials, disk cache, or raw transport error escapes. */
export const photoWire: PhotoWire = async (url, method, headers, body, signal, limit) => {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, method === "PUT" ? 300000 : 120000);
  try {
    if (signal?.aborted) throw new PhotoError("cancelled");
    // Native requestUrl cannot enforce abort or redirect:error for private grants.
    const response = await fetch(url, { method, headers: Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "content-length")), body, signal: controller.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    if (response.redirected || response.url !== url) throw new PhotoError("redirect_rejected");
    const declared = Number(response.headers.get("content-length"));
    if (declared > limit) throw new PhotoError("response_too_large");
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, body: new ArrayBuffer(0) };
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > limit) { await reader.cancel(); throw new PhotoError("response_too_large"); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return { status: response.status, body: output.buffer };
  } catch (error) { throw error instanceof PhotoError ? error : new PhotoError(controller.signal.aborted ? "cancelled_or_timeout" : "network_tls_or_cors"); }
  finally { window.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
};

export function validateObjectGrant(grant: Grant, method: "GET" | "PUT", id: string, settings: PhotoSettings, params?: UploadParameters): string {
  if (settings.endpoint !== DEFAULT_PHOTOS.endpoint || grant?.method !== method || !Number.isFinite(grant.expiresAt) || !Number.isFinite(grant.serverTime) || grant.expiresAt <= grant.serverTime || grant.expiresAt - grant.serverTime > (method === "PUT" ? 600 : 300)) throw new PhotoError("invalid_grant");
  photoId(id);
  let u: URL; try { u = new URL(grant.url); } catch { throw new PhotoError("invalid_object_url"); }
  const prefixes = method === "PUT" ? [PHOTO_PREFIX] : [PHOTO_PREFIX, LEGACY_PHOTO_PREFIX];
  const allowedPath = prefixes.some(prefix => new RegExp(`^/${prefix}photos/v1/[a-f0-9]{24}/${id}/original\\.(png|jpg|webp|gif)$`).test(u.pathname));
  if (u.protocol !== "https:" || u.host !== PHOTO_HOST || u.username || u.password || u.hash || !allowedPath || u.pathname.includes("%") || grant.url.includes("\\") || !u.search) throw new PhotoError("object_scope_rejected");
  const keys = [...u.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(k => !/^q-(sign-algorithm|ak|sign-time|key-time|header-list|url-param-list|signature)$/.test(k)) || u.searchParams.get("q-sign-algorithm") !== "sha1" || !/^[a-f0-9]{40}$/.test(u.searchParams.get("q-signature") ?? "")) throw new PhotoError("signature_parameters_rejected");
  const times = (u.searchParams.get("q-sign-time") ?? "").split(";").map(Number);
  if (times.length !== 2 || times.some(n => !Number.isSafeInteger(n)) || times[0] > grant.serverTime + 60 || times[1] <= grant.serverTime || times[1] > grant.expiresAt + 1 || u.searchParams.get("q-key-time") !== u.searchParams.get("q-sign-time") || !/^[a-zA-Z0-9]{1,128}$/.test(u.searchParams.get("q-ak") ?? "") || u.searchParams.get("q-url-param-list") !== "") throw new PhotoError("signature_scope_rejected");
  const headers = grant.headers ?? {};
  if (method === "GET" && Object.keys(headers).length) throw new PhotoError("read_headers_rejected");
  const signed = (u.searchParams.get("q-header-list") ?? "").split(";").sort();
  if (signed.join(";") !== ["host", ...Object.keys(headers)].sort().join(";")) throw new PhotoError("unsigned_headers_rejected");
  if (method === "PUT") {
    if (!params) throw new PhotoError("upload_parameters_missing");
    const expected = { "content-type": params.mime, "content-length": String(params.bytes), "content-md5": params.contentMd5, "x-cos-forbid-overwrite": "true", "x-cos-meta-sha256": params.sha256, "x-cos-meta-content-md5": params.contentMd5, "x-cos-acl": "private" };
    if (Object.keys(headers).length !== Object.keys(expected).length || Object.entries(expected).some(([k, v]) => headers[k] !== v) || !u.pathname.endsWith(`original.${PHOTO_MIMES[params.mime]}`)) throw new PhotoError("upload_headers_rejected");
  }
  return u.href;
}

export class PhotoClient {
  constructor(private settings: () => PhotoSettings, private token: () => string, private wire: PhotoWire = photoWire) {}
  get scope(): string { const s = this.settings(); return `${s.endpoint}|${PHOTO_PREFIX}|${s.tokenSecretId}`; }
  ready(): void {
    const s = this.settings(); const token = this.token();
    if (!s.enabled || s.endpoint !== DEFAULT_PHOTOS.endpoint) throw new PhotoError("disabled");
    if (!/^[\x21-\x7e]{32,4096}$/.test(token)) throw new PhotoError("token_required");
  }
  private async rpc<T>(path: string, data: unknown, signal?: AbortSignal, method = "POST"): Promise<T> {
    this.ready(); if (signal?.aborted) throw new PhotoError("cancelled");
    try {
      const result = await this.wire(this.settings().endpoint + path, method, { Authorization: `Bearer ${this.token()}`, "Content-Type": "application/json" }, method === "GET" ? undefined : new TextEncoder().encode(JSON.stringify(data)).buffer, signal, 65536);
      if (result.status !== 200) throw new PhotoError("authorization_failed", result.status);
      if (result.body.byteLength > 65536) throw new PhotoError("response_too_large");
      return (JSON.parse(new TextDecoder().decode(result.body)) as { data: T }).data;
    } catch (error) { throw error instanceof PhotoError ? error : new PhotoError("invalid_service_response"); }
  }
  private intent(value: Intent, op?: string): Intent {
    if (!value || (op && value.operationId !== op) || !UUID.test(value.operationId) || !UUID.test(value.photoId) || !["reserved", "confirmed", "unknown", "uploaded", "failed", "expired"].includes(value.state) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_PHOTO_BYTES || !PHOTO_MIMES[value.mime] || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new PhotoError("invalid_intent");
    return value;
  }
  async pair(code: string, name: string): Promise<string> {
    const result = await this.wire(DEFAULT_PHOTOS.endpoint + "devices/pair", "POST", { "Content-Type": "application/json" }, new TextEncoder().encode(JSON.stringify({ code, name })).buffer, undefined, 4096);
    if (result.status !== 200) throw new PhotoError("pairing_rejected", result.status);
    let token: unknown;
    try { token = (JSON.parse(new TextDecoder().decode(result.body)) as { data: { token: unknown } }).data.token; } catch { throw new PhotoError("invalid_pairing_response"); }
    if (typeof token !== "string" || !/^azp_[A-Za-z0-9_-]{43}$/.test(token)) throw new PhotoError("invalid_pairing_response");
    return token;
  }
  async create(params: UploadParameters, signal?: AbortSignal): Promise<Intent> { return this.intent(await this.rpc("uploads", params, signal), params.operationId); }
  async action(op: string, action: "complete" | "renew", data: unknown, signal?: AbortSignal): Promise<Intent> { return this.intent(await this.rpc(`uploads/${photoId(op)}/${action}`, data, signal), op); }
  async put(intent: Intent, params: UploadParameters, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.ready(); if (signal?.aborted) throw new PhotoError("cancelled");
    if (!intent.authorization || bytes.length !== params.bytes || intent.bytes !== params.bytes || intent.mime !== params.mime || intent.sha256 !== params.sha256) throw new PhotoError("upload_binding_mismatch");
    const url = validateObjectGrant(intent.authorization, "PUT", intent.photoId, this.settings(), params);
    try { const result = await this.wire(url, "PUT", intent.authorization.headers ?? {}, bytes.slice().buffer, signal, 65536); if (result.status !== 200) throw new PhotoError("upload_failed", result.status); }
    catch (error) { throw error instanceof PhotoError ? error : new PhotoError("upload_interrupted"); }
  }
  async read(id: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
    photoId(id);
    const values = await this.rpc<Intent[]>("read-authorizations", { photoIds: [id] }, signal);
    if (!Array.isArray(values) || values.length !== 1) throw new PhotoError("invalid_read_response");
    const intent = this.intent(values[0]);
    if (intent.photoId !== id || intent.state !== "confirmed" || !intent.authorization) throw new PhotoError("not_confirmed");
    const url = validateObjectGrant(intent.authorization, "GET", id, this.settings());
    if (!url.split("?")[0].endsWith(`original.${PHOTO_MIMES[intent.mime]}`)) throw new PhotoError("read_binding_mismatch");
    this.ready(); if (signal?.aborted) throw new PhotoError("cancelled");
    try {
      const result = await this.wire(url, "GET", {}, undefined, signal, intent.bytes);
      const bytes = new Uint8Array(result.body);
      if (result.status !== 200) throw new PhotoError("read_failed", result.status);
      if (bytes.length !== intent.bytes || await sha256(bytes) !== intent.sha256) throw new PhotoError("read_integrity_mismatch");
      return { bytes, mime: intent.mime };
    } catch (error) { throw error instanceof PhotoError ? error : new PhotoError("read_interrupted"); }
  }
}
