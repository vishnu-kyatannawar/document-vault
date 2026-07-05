// pdf.js setup + render helpers. The worker is bundled by Vite and served from
// our own origin (satisfies the `worker-src 'self'` CSP).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;

/** Parse a PDF from raw bytes. */
export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}

/**
 * Render a single page into a fresh canvas sized to `cssWidth` (device-pixel
 * aware for crisp output). Returns the canvas element.
 */
export async function renderPageToCanvas(
  pdf: PdfDoc,
  pageNumber: number,
  cssWidth: number,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (cssWidth / base.width) * dpr;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}
