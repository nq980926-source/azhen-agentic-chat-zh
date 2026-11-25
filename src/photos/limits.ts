export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_BATCH_BYTES = 40 * 1024 * 1024;
export const MAX_PHOTO_COUNT = 4;
export function validatePhotoSelection(images: ReadonlyArray<{ size: number }>): void {
  if (!images.length || images.length > MAX_PHOTO_COUNT || images.some(i => !Number.isSafeInteger(i.size) || i.size < 1 || i.size > MAX_PHOTO_BYTES) || images.reduce((n, i) => n + i.size, 0) > MAX_PHOTO_BATCH_BYTES) {
    throw new Error("每张最多 10 MiB，每批最多 4 张、合计最多 40 MiB；不会压缩原图");
  }
}
