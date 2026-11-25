import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MAX_PHOTO_BYTES, MAX_PHOTO_BATCH_BYTES, validatePhotoSelection } from "../../src/photos/limits";
import { readLocalImage } from "../../src/ui/local-images";
import { bytesFromBase64, contentMd5, sha256 } from "../../src/photos/digests";

describe("daily original-photo contract (no cloud simulation)", () => {
  it("accepts four exact 10 MiB originals, 40 MiB total", () => {
    expect(MAX_PHOTO_BYTES).toBe(10485760); expect(MAX_PHOTO_BATCH_BYTES).toBe(41943040);
    expect(() => validatePhotoSelection(Array.from({ length: 4 }, () => ({ size: MAX_PHOTO_BYTES })))).not.toThrow();
  });
  it.each([[], [{size:MAX_PHOTO_BYTES+1}], Array.from({length:5},()=>({size:1})), [{size:0}], [{size:-1}], [{size:1.1}]])("rejects invalid or oversized selections before authorization: %j", (...items) => {
    expect(() => validatePhotoSelection(items as {size:number}[])).toThrow();
  });
  it("keeps all 10 MiB of selected file bytes, with MD5 and SHA256 matching native crypto", async () => {
    const bytes = new Uint8Array(MAX_PHOTO_BYTES); bytes.set([137,80,78,71,13,10,26,10]); bytes[bytes.length-1]=247;
    const file = new File([bytes], "original.png", {type:"image/png"});
    const image = await readLocalImage(file); const restored = bytesFromBase64(image.data);
    expect(image.size).toBe(bytes.length); expect(Buffer.compare(Buffer.from(restored), Buffer.from(bytes))).toBe(0);
    expect(contentMd5(restored)).toBe(createHash("md5").update(bytes).digest("base64"));
    expect(await sha256(restored)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it("refuses a selected file over 10 MiB without reading or compressing it", async () => {
    const file = new File([new Uint8Array(MAX_PHOTO_BYTES+1)], "large.png");
    await expect(readLocalImage(file)).rejects.toThrow("10 MiB");
  });
});
