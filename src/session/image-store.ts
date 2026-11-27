import type { DataAdapter } from "obsidian";

const PREFIX = "azhen-image:v1:";
const CHUNK = 512 * 1024;
const MAX_IMAGE = 4 * Math.ceil(10 * 1024 * 1024 / 3);

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Local, lossless image storage. No cloud, compression, Node fs or automatic deletion. */
export class SessionImageStore {
  constructor(private adapter: DataAdapter, private root: string) {}

  private async readSmall(path: string): Promise<string> {
    const stat = await this.adapter.stat(path);
    if (!stat || stat.size > CHUNK) throw new Error("聊天图片分块缺失或超过安全读取大小。");
    return this.adapter.read(path);
  }

  private async ensureRoot(): Promise<void> {
    let current = "";
    for (const part of this.root.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.adapter.exists(current))) {
        try { await this.adapter.mkdir(current); }
        catch (error) { if (!(await this.adapter.exists(current))) throw error; }
      }
    }
  }

  private async save(data: string): Promise<string> {
    if (data.length > MAX_IMAGE || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4) {
      throw new Error("图片数据无效或超过 10 MiB；原会话未修改。");
    }
    const id = await hash(data);
    const marker = `${this.root}/${id}.complete`;
    const reference = `${PREFIX}${id}:${data.length}`;
    if (await this.adapter.exists(marker)) {
      if (await this.readSmall(marker) !== reference) throw new Error("图片存储校验失败；原会话未修改。");
      return reference;
    }
    await this.ensureRoot();
    for (let start = 0, index = 0; start < data.length; start += CHUNK, index++) {
      const path = `${this.root}/${id}.${index}.b64`;
      const chunk = data.slice(start, start + CHUNK);
      if (await this.adapter.exists(path)) {
        if (await this.readSmall(path) !== chunk) throw new Error("图片分块发生冲突；原会话未修改。");
      } else await this.adapter.write(path, chunk);
    }
    await this.adapter.write(marker, reference);
    return reference;
  }

  async encode<T>(value: T): Promise<T> {
    return this.walk(value, async data => data.startsWith(PREFIX) ? data : data.length >= 65536 ? this.save(data) : data);
  }

  async decode<T>(value: T): Promise<T> {
    const cache = new Map<string, string>();
    let total = 0;
    return this.walk(value, async data => {
      if (!data.startsWith(PREFIX)) return data;
      const cached = cache.get(data);
      if (cached !== undefined) return cached;
      const match = /^azhen-image:v1:([a-f0-9]{64}):([0-9]+)$/.exec(data);
      if (!match) throw new Error("图片引用格式无效。");
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE || total + size > 48 * 1024 * 1024) {
        throw new Error("此会话图片过多，请新建会话；原会话保留。");
      }
      total += size;
      const chunks: string[] = [];
      for (let start = 0, index = 0; start < size; start += CHUNK, index++) {
        const path = `${this.root}/${match[1]}.${index}.b64`;
        const stat = await this.adapter.stat(path);
        if (!stat || stat.size > CHUNK) throw new Error("聊天原图分块缺失或异常，请恢复对应图片文件。");
        const chunk = await this.adapter.read(path);
        if (chunk.length !== Math.min(CHUNK, size - start)) throw new Error("聊天原图分块不完整。");
        chunks.push(chunk);
      }
      const original = chunks.join("");
      if (await hash(original) !== match[1]) throw new Error("聊天原图完整性校验失败。");
      cache.set(data, original);
      return original;
    });
  }

  private async walk<T>(value: T, transform: (data: string) => Promise<string>): Promise<T> {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) result.push(await this.walk(item, transform));
      return result as T;
    }
    const object = value as Record<string, unknown>;
    if (object.type === "image" && typeof object.data === "string" && typeof object.mimeType === "string" && /^image\//.test(object.mimeType)) {
      return { ...object, data: await transform(object.data) } as T;
    }
    const result: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(object)) result.push([key, await this.walk(item, transform)]);
    return Object.fromEntries(result) as T;
  }
}
