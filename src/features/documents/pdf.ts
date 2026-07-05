// pdf.js setup + render helpers. The worker is bundled by Vite and served from
// our own origin (satisfies the `worker-src 'self'` CSP).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;

// Mobile Safari fails silently past ~16M canvas pixels; stay comfortably under.
const MAX_CANVAS_WIDTH = 4096;
const MAX_CANVAS_AREA = 14_000_000;

/** Parse a PDF from raw bytes. */
export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}

/**
 * Render a single page into a fresh canvas displayed at `cssWidth`.
 * `quality` = device pixels per CSS pixel (raise it when zoomed in so the
 * vector source stays crisp instead of CSS-stretching a low-res raster).
 * Clamped to safe canvas limits for mobile browsers.
 */
export async function renderPageToCanvas(
  pdf: PdfDoc,
  pageNumber: number,
  cssWidth: number,
  quality: number = Math.min(window.devicePixelRatio || 1, 2),
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });

  let scale = (cssWidth / base.width) * quality;
  const widthPx = base.width * scale;
  const heightPx = base.height * scale;
  const shrink = Math.min(
    1,
    MAX_CANVAS_WIDTH / widthPx,
    Math.sqrt(MAX_CANVAS_AREA / (widthPx * heightPx)),
  );
  scale *= shrink;

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(cssWidth * (base.height / base.width))}px`;

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}
