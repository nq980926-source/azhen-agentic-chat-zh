import { arrayBufferToBase64 } from "./image-attachments";

export interface LocalImageAttachment {
  name: string;
  size: number;
  data: string;
  mimeType: string;
}

/** Read only into composer memory; never writes to the vault or uploads. */
export async function readLocalImage(file: File): Promise<LocalImageAttachment> {
  if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) throw new Error("仅支持 PNG、JPEG、WebP 和 GIF 图片");
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("单张图片必须大于 0 且不超过 10 MB");
  let buffer: ArrayBuffer;
  try { buffer = await file.arrayBuffer(); }
  catch { throw new Error(`图片读取失败：${file.name}`); }
  const b = new Uint8Array(buffer);
  const ascii = (start: number, end: number) => String.fromCharCode(...b.slice(start, end));
  const mimeType = b[0] === 137 && ascii(1, 4) === "PNG" ? "image/png"
    : b[0] === 255 && b[1] === 216 && b[2] === 255 ? "image/jpeg"
    : /^GIF8[79]a$/.test(ascii(0, 6)) ? "image/gif"
    : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" ? "image/webp" : null;
  if (!mimeType) throw new Error(`图片格式无效：${file.name}`);
  return { name: file.name, size: buffer.byteLength, data: arrayBufferToBase64(buffer), mimeType };
}
