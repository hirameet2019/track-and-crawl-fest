const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * Browser-side downscale before upload so a 5 MB phone photo becomes a few
 * hundred KB. Falls back to the original file when the browser cannot decode
 * it (for example HEIC on non-Apple browsers).
 */
export async function shrinkImage(file: File, maxEdge = MAX_EDGE): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_000_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif)$/i;
