/**
 * Client-side image compression for HR-POL-2026 reimbursement attachments.
 * Images are stored in Firestore as JPEG data URLs (no Firebase Storage), so
 * every upload is resized (max 1600px) and re-encoded until it fits ~300 KB.
 * A SHA-256 of the compressed bytes is used to detect re-used screenshots.
 *
 * Keep in sync with mft-admin/src/lib/admin/imageCompress.ts.
 */

export interface CompressedImage {
  dataUrl: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  quality: number;
  fileName: string;
}

export const MAX_ATTACHMENT_BYTES = 300 * 1024;
const MAX_EDGE = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("تعذر قراءة الصورة — استخدم JPG أو PNG أو WEBP."));
    };
    img.src = url;
  });
}

function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function sha256OfDataUrl(dataUrl: string): Promise<string> {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback (non-secure context): cheap FNV-1a — still good enough for duplicate detection.
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv-${h.toString(16)}-${buf.length}`;
}

export async function compressImage(file: File, maxBytes = MAX_ATTACHMENT_BYTES): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) throw new Error("الملف المرفوع ليس صورة.");
  const img = await loadImage(file);
  let scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  let quality = 0.85;
  let dataUrl = "";
  let w = 0;
  let h = 0;

  for (let attempt = 0; attempt < 12; attempt++) {
    w = Math.max(1, Math.round(img.naturalWidth * scale));
    h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("المتصفح لا يدعم ضغط الصور.");
    ctx.fillStyle = "#fff"; // flatten PNG transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(dataUrl) <= maxBytes) break;
    if (quality > 0.5) quality = Math.round((quality - 0.1) * 100) / 100;
    else scale *= 0.8;
  }

  const bytes = dataUrlBytes(dataUrl);
  if (bytes > maxBytes) throw new Error("تعذر ضغط الصورة إلى الحجم المسموح — جرّب لقطة أصغر.");
  return { dataUrl, sha256: await sha256OfDataUrl(dataUrl), width: w, height: h, bytes, originalBytes: file.size, quality, fileName: file.name };
}
