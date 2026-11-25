import type { AgentTool, AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { PhotoResult, PhotoSource } from "./tasks";
import { PHOTO_MIMES, PhotoError } from "./client";
import { normalizeVaultPath } from "../vault/path";

export function sourceFromMessage(message: AgentMessage, key: string): PhotoSource | null {
  if (message.role !== "user" || !Array.isArray(message.content)) return null;
  const images = message.content.filter(p => p.type === "image");
  if (!images.length || images.some(p => !PHOTO_MIMES[p.mimeType] || !p.data || !/^[a-zA-Z0-9+/]*={0,2}$/.test(p.data))) return null;
  return { key, images: images.map((p, i) => ({ name: `聊天照片 ${i + 1}`, mimeType: p.mimeType, data: p.data, size: Math.floor(p.data.length * 3 / 4) - (p.data.endsWith("==") ? 2 : p.data.endsWith("=") ? 1 : 0) })) };
}
export type SavePhotos = (source: PhotoSource, signal?: AbortSignal, valid?: () => boolean) => Promise<PhotoResult[]>;
const Parameters = Type.Object({ purpose: Type.String({ maxLength: 200, description: "User-requested purpose for saving selected chat photos. Never save ordinary image analysis automatically." }), target: Type.Optional(Type.String({ maxLength: 500, description: "Exact local Vault-relative Markdown path, if the user asked for a note. No cloud note paths." })) });
export function createPhotoTool(save: SavePhotos, messages: () => AgentMessage[], sessionId: () => string, sessionToken: () => string, permitted: () => boolean): AgentTool {
  return {
    name: "save_photos", label: "申请保存照片至私有 COS", parameters: Parameters, executionMode: "sequential",
    description: "Only when the user explicitly asks to save photos: present the latest identifiable original chat photos for per-image confirmation. A human must select images and click Confirm upload each time; approval modes cannot bypass this. Returns ONLY server-confirmed stable Markdown references, never original image bytes. After upload, save diary text and confirmed references with existing local read/write/edit tools; preserve text if upload fails. Never write signed URLs or invent photoIds. If the note write fails, retain references for retry; never delete COS objects.",
    execute: async (_id, params, signal) => {
      if (!permitted()) throw new PhotoError("local_mode_required");
      const p = params as { purpose: string; target?: string };
      const list = messages(); let source: PhotoSource | null = null;
      for (let i = list.length - 1; i >= 0; i--) { source = sourceFromMessage(list[i], `${sessionId()}:${list[i].timestamp ?? i}`); if (source) break; }
      if (!source) throw new PhotoError("original_image_source_not_found");
      const token = sessionToken();
      const target = p.target ? normalizeVaultPath(p.target) : undefined;
      if (target && !target.endsWith(".md")) throw new PhotoError("markdown_target_required");
      const results = await save({ ...source, purpose: p.purpose, target }, signal, () => permitted() && sessionToken() === token);
      return { content: [{ type: "text", text: results.length ? results.map(r => r.status === "confirmed" ? `照片 ${r.index + 1} confirmed: ${r.reference}` : `照片 ${r.index + 1} ${r.status}: ${r.error ?? "interrupted"}`).join("\n") : "用户取消、未批准或会话已中断。未继续上传。保留日记文字，勿生成照片引用。" }], details: { kind: "photos", results } };
    },
  };
}
