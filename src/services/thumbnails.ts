// Generates real card previews from file bytes, because Drive's thumbnailLink
// is a googleusercontent URL that rejects our Bearer token. Images are
// downscaled; PDFs are rendered (first page) via pdf.js. Results are cached as
// self-contained data URLs keyed by Drive file id.

import { DocumentPart } from './documentsService';
import { documents } from './vault';

const THUMB_WIDTH = 400;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

async function downscaleImage(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function renderPdfThumb(blob: Blob): Promise<string> {
  // Lazy-load pdf.js so it isn't in the initial bundle.
  const { loadPdf, renderPageToCanvas } = await import('../features/documents/pdf');
  const pdf = await loadPdf(await blob.arrayBuffer());
  const canvas = await renderPageToCanvas(pdf, 1, THUMB_WIDTH);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** Returns a cached data-URL thumbnail for a part, generating it if needed. */
export function getThumbnail(part: DocumentPart): Promise<string> {
  const hit = cache.get(part.id);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(part.id);
  if (existing) return existing;

  const task = (async () => {
    const blob = await documents.getPartBlob(part.id);
    const url =
      part.mimeType === 'application/pdf'
        ? await renderPdfThumb(blob)
        : await downscaleImage(blob);
    cache.set(part.id, url);
    inflight.delete(part.id);
    return url;
  })().catch((e) => {
    inflight.delete(part.id);
    throw e;
  });

  inflight.set(part.id, task);
  return task;
}
