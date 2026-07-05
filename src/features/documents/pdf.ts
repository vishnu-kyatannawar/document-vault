// pdf.js setup + render helpers. The worker is bundled by Vite and served from
// our own origin (satisfies the `worker-src 'self'` CSP).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { logger } from '../../services/logger';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;

// Canvas limits differ wildly per browser and exceeding them fails SILENTLY —
// the canvas just renders blank. Safari hard-caps around 16.7M pixels; mobile
// Chrome is bound by device memory (a 70M-pixel canvas ≈ 280MB RGBA and simply
// blanks). Desktop Chromium/Firefox tolerate much more.
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(UA);
const IS_SAFARI =
  /iPad|iPhone|iPod/.test(UA) || /^((?!chrome|chromium|android).)*safari/i.test(UA);
const CONSERVATIVE = IS_SAFARI || IS_MOBILE;

const MAX_CANVAS_WIDTH = CONSERVATIVE ? 4096 : 8192;
const MAX_CANVAS_AREA = CONSERVATIVE ? 16_000_000 : 100_000_000;

/** Parse a PDF from raw bytes. */
export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}

function clampScale(baseW: number, baseH: number, cssWidth: number, quality: number): number {
  let scale = (cssWidth / baseW) * quality;
  const widthPx = baseW * scale;
  const heightPx = baseH * scale;
  const shrink = Math.min(
    1,
    MAX_CANVAS_WIDTH / widthPx,
    Math.sqrt(MAX_CANVAS_AREA / (widthPx * heightPx)),
  );
  return scale * shrink;
}

/**
 * pdf.js paints an opaque page background, so a successfully rendered canvas
 * is opaque everywhere. A canvas past the browser's (undocumented) limit stays
 * fully transparent — sample one centre pixel to tell the two apart.
 */
function renderedBlank(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  try {
    const x = Math.max(0, Math.floor(canvas.width / 2));
    const y = Math.max(0, Math.floor(canvas.height / 2));
    return ctx.getImageData(x, y, 1, 1).data[3] === 0;
  } catch {
    return true;
  }
}

/**
 * Render a single page into a fresh canvas displayed at `cssWidth`.
 * `quality` = device pixels per CSS pixel (raised when zoomed so the vector
 * source stays crisp). If the browser silently blanks the canvas (over its
 * memory limit), automatically retries at progressively lower quality.
 */
export async function renderPageToCanvas(
  pdf: PdfDoc,
  pageNumber: number,
  cssWidth: number,
  quality: number = Math.min(window.devicePixelRatio || 1, 3),
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const cssHeight = Math.floor(cssWidth * (base.height / base.width));

  const attempts = [...new Set(
    [quality, quality * 0.6, quality * 0.35, 1].map((q) => Math.max(1, q)),
  )];

  let canvas!: HTMLCanvasElement;
  for (const q of attempts) {
    const viewport = page.getViewport({
      scale: clampScale(base.width, base.height, cssWidth, q),
    });
    canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    try {
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    } catch (e) {
      logger.warn(`PDF page ${pageNumber} render failed at quality ${q}`, e as Error);
      canvas.width = canvas.height = 0; // release the backing store
      continue;
    }

    if (!renderedBlank(canvas, ctx)) return canvas;

    logger.warn(
      `PDF page ${pageNumber} blank at quality ${q} (${canvas.width}x${canvas.height}) — retrying lower`,
    );
    canvas.width = canvas.height = 0;
  }

  logger.error(`PDF page ${pageNumber} blank at every quality tier`);
  return canvas;
}
