import { useEffect, useRef, useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { addOutline, removeOutline, scanOutline } from 'ionicons/icons';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { DocumentPart } from '../../services/documentsService';
import { documents as service } from '../../services/vault';
import './PartViewer.css';

/** Renders all pages of a PDF blob into stacked canvases inside its container. */
function PdfPages({ blob, onReady }: { blob: Blob; onReady: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const host = ref.current!;
    (async () => {
      const { loadPdf, renderPageToCanvas } = await import('./pdf');
      const pdf = await loadPdf(await blob.arrayBuffer());
      const width = Math.min(window.innerWidth, 900);
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (cancelled) return;
        const canvas = await renderPageToCanvas(pdf, i, width);
        canvas.className = 'pv-pdf__page';
        if (cancelled) return;
        host.appendChild(canvas);
        if (i === 1) onReady();
      }
    })().catch(() => onReady());

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, [blob, onReady]);

  return <div className="pv-pdf" ref={ref} />;
}

/** A single document part (image or PDF) with pinch / double-tap / wheel zoom. */
export default function PartViewer({ part }: { part: DocumentPart }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      .catch((e) => active && setError((e as Error).message));

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
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <TransformComponent wrapperClass="pv-wrap" contentClass="pv-content">
                {isPdf ? (
                  <PdfPages blob={blob} onReady={() => setReady(true)} />
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
