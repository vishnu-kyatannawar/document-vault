// Generates real card previews from file bytes, because Drive's thumbnailLink
// is a googleusercontent URL that rejects our Bearer token. Images are
// downscaled; PDFs are rendered (first page) via pdf.js.
//
// Caching: in-memory Map for the session + IndexedDB across sessions, so a
// refresh doesn't re-download every full-size file just to draw the grid.
// Generation is capped to a few concurrent downloads to keep mobile happy.

import { DocumentPart } from './documentsService';
import { documents } from './vault';
import { cacheGet, cacheSet } from './thumbCache';

const THUMB_WIDTH = 400;
const MAX_CONCURRENT = 3;

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((release) => waiters.push(release));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

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

async function generate(part: DocumentPart): Promise<string> {
  const persisted = await cacheGet(part.id);
  if (persisted) return persisted;

  return withSlot(async () => {
    const blob = await documents.getPartBlob(part.id);
    const url =
      part.mimeType === 'application/pdf'
        ? await renderPdfThumb(blob)
        : await downscaleImage(blob);
    void cacheSet(part.id, url);
    return url;
  });
}

/** Returns a cached preview for a part, generating (and persisting) if needed. */
export function getThumbnail(part: DocumentPart): Promise<string> {
  const hit = memory.get(part.id);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(part.id);
  if (existing) return existing;

  const task = generate(part)
    .then((url) => {
      memory.set(part.id, url);
      return url;
    })
    .finally(() => inflight.delete(part.id));
  inflight.set(part.id, task);
  return task;
}

/** Drop the in-memory cache (sign-out). IndexedDB is cleared separately. */
export function clearThumbnailMemory(): void {
  memory.clear();
  inflight.clear();
}
