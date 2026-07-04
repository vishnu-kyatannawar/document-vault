import { useEffect, useState } from 'react';
import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { openOutline } from 'ionicons/icons';
import { DocumentPart } from '../../services/documentsService';
import { documents as service } from '../../services/vault';

/** Fetches and renders a single document part (image or PDF) at full resolution. */
export default function PartViewer({ part }: { part: DocumentPart }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPdf = part.mimeType === 'application/pdf';

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    setUrl(null);
    setError(null);

    (async () => {
      try {
        const blob = await service.getPartBlob(part.id);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [part.id]);

  if (error) return <div className="part-viewer__msg">Failed to load: {error}</div>;
  if (!url)
    return (
      <div className="part-viewer__msg">
        <IonSpinner name="crescent" />
      </div>
    );

  if (isPdf) {
    return (
      <div className="part-viewer part-viewer--pdf">
        <embed src={url} type="application/pdf" className="part-viewer__pdf" />
        <IonButton
          fill="solid"
          className="part-viewer__open"
          onClick={() => window.open(url, '_blank', 'noopener')}
        >
          <IonIcon slot="start" icon={openOutline} /> Open PDF
        </IonButton>
      </div>
    );
  }

  return (
    <div className="part-viewer">
      <img src={url} alt={part.label} className="part-viewer__img" />
    </div>
  );
}
