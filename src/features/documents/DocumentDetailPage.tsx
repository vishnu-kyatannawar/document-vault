import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonActionSheet,
  useIonToast,
} from '@ionic/react';
import {
  addOutline,
  cameraOutline,
  documentAttachOutline,
  downloadOutline,
  ellipsisVertical,
  imagesOutline,
  shareSocialOutline,
  trashOutline,
} from 'ionicons/icons';
import { RouteComponentProps } from 'react-router-dom';
import { useDocumentsStore } from '../../store/documentsStore';
import { documents as service } from '../../services/vault';
import { DocumentPart } from '../../services/documentsService';
import { downloadFile, shareFile } from '../share/share';
import { CaptureSource, pickFiles, suggestFilename } from '../capture/capture';
import PartViewer from './PartViewer';
import './DocumentDetailPage.css';

type Props = RouteComponentProps<{ id: string }>;

export default function DocumentDetailPage({ match, history }: Props) {
  const { id } = match.params;
  const { items, load, addPart, removePart, remove } = useDocumentsStore();
  const doc = useMemo(() => items.find((d) => d.id === id), [items, id]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [presentActionSheet] = useIonActionSheet();
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (!doc) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  if (!doc) {
    return (
      <IonPage>
        <IonContent className="detail-center">
          <IonSpinner name="crescent" />
        </IonContent>
      </IonPage>
    );
  }

  const part: DocumentPart | undefined = doc.parts[active];

  const withBlob = async (p: DocumentPart) => ({
    filename: p.name,
    mimeType: p.mimeType,
    blob: await service.getPartBlob(p.id),
  });

  const onDownload = async () => {
    if (!part) return;
    setBusy(true);
    try {
      downloadFile(await withBlob(part));
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    if (!part) return;
    setBusy(true);
    try {
      const result = await shareFile(await withBlob(part), `${doc.title} — ${part.label}`);
      if (result === 'fallback') {
        presentToast({
          message: 'File downloaded — attach it in WhatsApp.',
          duration: 2500,
        });
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        presentToast({ message: `Share failed: ${(e as Error).message}`, duration: 2500 });
      }
    } finally {
      setBusy(false);
    }
  };

  const addFrom = (source: CaptureSource) =>
    pickFiles(source, false).then(async (files) => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      try {
        const label = `Page ${doc.parts.length + 1}`;
        await addPart(doc.id, {
          label,
          filename: suggestFilename(label, file),
          blob: file,
        });
        setActive(doc.parts.length);
      } finally {
        setBusy(false);
      }
    });

  const openAddPart = () =>
    presentActionSheet({
      header: 'Add a page',
      buttons: [
        { text: 'Take photo', icon: cameraOutline, handler: () => addFrom('camera') },
        { text: 'Choose from gallery', icon: imagesOutline, handler: () => addFrom('gallery') },
        { text: 'Upload file', icon: documentAttachOutline, handler: () => addFrom('files') },
        { text: 'Cancel', role: 'cancel' },
      ],
    });

  const onDeletePart = () => {
    if (!part) return;
    presentActionSheet({
      header: `Delete "${part.label}"?`,
      buttons: [
        {
          text: 'Delete page',
          role: 'destructive',
          icon: trashOutline,
          handler: async () => {
            await removePart(doc.id, part.id);
            setActive((i) => Math.max(0, i - 1));
          },
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
  };

  const onOverflow = () =>
    presentActionSheet({
      header: doc.title,
      buttons: [
        { text: 'Add page', icon: addOutline, handler: openAddPart },
        {
          text: 'Delete document',
          role: 'destructive',
          icon: trashOutline,
          handler: async () => {
            await remove(doc.id);
            history.replace('/documents');
          },
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/documents" />
          </IonButtons>
          <IonTitle>{doc.title}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onOverflow}>
              <IonIcon slot="icon-only" icon={ellipsisVertical} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="detail">
        <div className="detail__viewer" ref={scroller} onScroll={onScroll}>
          {doc.parts.map((p) => (
            <div className="detail__slide" key={p.id}>
              <PartViewer part={p} />
            </div>
          ))}
        </div>

        {doc.parts.length > 1 && (
          <div className="detail__dots">
            {doc.parts.map((p, i) => (
              <button
                key={p.id}
                className={i === active ? 'active' : ''}
                aria-label={p.label}
                onClick={() => {
                  scroller.current?.scrollTo({ left: i * scroller.current.clientWidth });
                }}
              />
            ))}
          </div>
        )}

        {part && <div className="detail__label">{part.label}</div>}
      </IonContent>

      <IonToolbar className="detail__actions">
        <IonButtons className="detail__actionbar">
          <IonButton onClick={onDownload} disabled={busy}>
            <IonIcon slot="start" icon={downloadOutline} /> Download
          </IonButton>
          <IonButton onClick={onShare} disabled={busy}>
            <IonIcon slot="start" icon={shareSocialOutline} /> Share
          </IonButton>
          <IonButton onClick={onDeletePart} disabled={busy} color="danger">
            <IonIcon slot="start" icon={trashOutline} /> Delete
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonPage>
  );
}
