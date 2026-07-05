import { useEffect, useRef, useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { addOutline, removeOutline, scanOutline } from 'ionicons/icons';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { DocumentPart } from '../../services/documentsService';
import { documents as service } from '../../services/vault';
import { logger } from '../../services/logger';
import './PartViewer.css';

/**
 * Renders all pages of a PDF blob into stacked canvases. PDFs are vector, so
 * pages are RE-rendered at higher resolution whenever the user zooms in —
 * CSS-stretching a fixed raster (the old behaviour) turned zoom into blur.
 */
function PdfPages({
  blob,
  zoom,
  onReady,
}: {
  blob: Blob;
  zoom: number;
  onReady: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<import('./pdf').PdfDoc | null>(null);
  const qualityRef = useRef(0);
  const [docReady, setDocReady] = useState(false);

  // Parse the document once per blob.
  useEffect(() => {
    let cancelled = false;
    qualityRef.current = 0;
    setDocReady(false);
    (async () => {
      const { loadPdf } = await import('./pdf');
      const pdf = await loadPdf(await blob.arrayBuffer());
      if (cancelled) return;
      pdfRef.current = pdf;
      setDocReady(true);
    })().catch((e) => {
      logger.error('PDF parse failed', e as Error);
      onReady();
    });
    return () => {
      cancelled = true;
      pdfRef.current?.loadingTask.destroy().catch(() => undefined);
      pdfRef.current = null;
    };
  }, [blob, onReady]);

  // Render pages; re-render sharper when the settled zoom outgrows the raster.
  useEffect(() => {
    if (!docReady) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const needed = Math.max(1, Math.min(zoom, 6)) * dpr;
    if (needed <= qualityRef.current * 1.25) return; // current raster is sharp enough
    qualityRef.current = needed;

    let cancelled = false;
    (async () => {
      const { renderPageToCanvas } = await import('./pdf');
      const pdf = pdfRef.current;
      const host = ref.current;
      if (!pdf || !host) return;
      const width = Math.min(window.innerWidth, 900);
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (cancelled) return;
        const canvas = await renderPageToCanvas(pdf, i, width, needed);
        canvas.className = 'pv-pdf__page';
        if (cancelled) return;
        const previous = host.children[i - 1];
        if (previous) host.replaceChild(canvas, previous);
        else host.appendChild(canvas);
        if (i === 1) onReady();
      }
    })().catch((e) => {
      logger.error('PDF page render failed', e as Error);
      onReady();
    });
    return () => {
      cancelled = true;
    };
  }, [docReady, zoom, onReady]);

  return <div className="pv-pdf" ref={ref} />;
}

/** A single document part (image or PDF) with pinch / double-tap / wheel zoom. */
export default function PartViewer({ part }: { part: DocumentPart }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Settled zoom level — drives PDF re-rendering for crisp zoomed pages.
  const [zoom, setZoom] = useState(1);
  const isPdf = part.mimeType === 'application/pdf';

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setBlob(null);
    setUrl(null);
    setReady(false);
    setError(null);

    service
      .getPartBlob(part.id)
      .then((b) => {
        if (!active) return;
        setBlob(b);
        if (!isPdf) {
          objectUrl = URL.createObjectURL(b);
          setUrl(objectUrl);
          setReady(true);
        }
      })
      .catch((e) => {
        logger.error('Part download failed', e as Error);
        if (active) setError((e as Error).message);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [part.id, isPdf]);

  if (error) return <div className="pv-msg">Failed to load: {error}</div>;

  return (
    <div className="pv">
      {!ready && (
        <div className="pv-msg pv-loading">
          <IonSpinner name="crescent" />
        </div>
      )}

      {blob && (
        <TransformWrapper
          minScale={1}
          maxScale={6}
          doubleClick={{ mode: 'toggle', step: 2 }}
          wheel={{ step: 0.15 }}
          pinch={{ step: 5 }}
          centerZoomedOut
          onZoomStop={(ref) => setZoom(ref.state.scale)}
          onWheelStop={(ref) => setZoom(ref.state.scale)}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <TransformComponent wrapperClass="pv-wrap" contentClass="pv-content">
                {isPdf ? (
                  <PdfPages blob={blob} zoom={zoom} onReady={() => setReady(true)} />
                ) : (
                  <img src={url ?? ''} alt={part.label} className="pv-img" />
                )}
              </TransformComponent>

              <div className="pv-controls">
                <button aria-label="Zoom out" onClick={() => zoomOut()}>
                  <IonIcon icon={removeOutline} />
                </button>
                <button aria-label="Reset zoom" onClick={() => resetTransform()}>
                  <IonIcon icon={scanOutline} />
                </button>
                <button aria-label="Zoom in" onClick={() => zoomIn()}>
                  <IonIcon icon={addOutline} />
                </button>
              </div>
            </>
          )}
        </TransformWrapper>
      )}
    </div>
  );
}
