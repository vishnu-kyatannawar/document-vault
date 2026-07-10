import { useEffect, useState } from 'react';
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
  useIonAlert,
  useIonToast,
} from '@ionic/react';
import {
  addOutline,
  cameraOutline,
  createOutline,
  documentAttachOutline,
  documentTextOutline,
  downloadOutline,
  imagesOutline,
  shareOutline,
  shareSocialOutline,
  swapHorizontalOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { RouteComponentProps } from 'react-router-dom';
import { ROOT_KEY, useDocumentsStore } from '../../store/documentsStore';
import { documents as service } from '../../services/vault';
import {
  DocumentPart,
  VaultDocument,
  expiryInfo,
} from '../../services/documentsService';
import EditDetailsModal from './EditDetailsModal';
import { downloadFile, shareFile } from '../share/share';
import { CaptureSource, pickFiles, suggestFilename } from '../capture/capture';
import { logger } from '../../services/logger';
import PartViewer from './PartViewer';
import MoveTargetModal from './MoveTargetModal';
import ExportSheet from '../transfer/ExportSheet';
import './DocumentDetailPage.css';

type Props = RouteComponentProps<{ id: string }>;

export default function DocumentDetailPage({ match, history }: Props) {
  const { id } = match.params;
  const invalidateForParent = useDocumentsStore((s) => s.invalidateForParent);
  const invalidateLevel = useDocumentsStore((s) => s.invalidateLevel);
  const storeDoc = useDocumentsStore((s) => {
    for (const level of Object.values(s.levels)) {
      const found = level.documents.find((d) => d.id === id);
      if (found) return found;
    }
    return undefined;
  });

  const [doc, setDoc] = useState<VaultDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFromKey, setMoveFromKey] = useState(ROOT_KEY);
  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [presentActionSheet] = useIonActionSheet();
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();

  // Initialise from the browse cache; deep links fetch the doc directly.
  useEffect(() => {
    if (doc && doc.id === id) return;
    if (storeDoc) {
      setDoc(storeDoc);
      return;
    }
    service
      .getDocument(id)
      .then((d) => (d ? setDoc(d) : setMissing(true)))
      .catch((e) => {
        logger.error('Document fetch failed', e as Error);
        setMissing(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, storeDoc]);

  const toastError = (prefix: string, e: unknown) => {
    if ((e as Error).name === 'AbortError') return; // user closed the share sheet
    logger.error(prefix, e as Error);
    presentToast({ message: `${prefix}: ${(e as Error).message}`, duration: 3000 });
  };

  const parentRoute = async (): Promise<string> => {
    if (!doc) return '/documents';
    const rootId = await service.ensureRoot();
    return doc.parentId === rootId ? '/documents' : `/g/${doc.parentId}`;
  };

  if (missing) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/documents" />
            </IonButtons>
            <IonTitle>Not found</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="detail-center">
          <p>This document no longer exists.</p>
        </IonContent>
      </IonPage>
    );
  }

  if (!doc) {
    return (
      <IonPage>
        <IonContent className="detail-center">
          <IonSpinner name="crescent" />
        </IonContent>
      </IonPage>
    );
  }

  const safeActive = Math.min(active, Math.max(0, doc.parts.length - 1));
  const part: DocumentPart | undefined = doc.parts[safeActive];

  const info = expiryInfo(doc);
  const expiryLabel = (() => {
    if (!doc.expiresAt || !info) return null;
    const [y, m, d] = doc.expiresAt.split('-').map(Number);
    const pretty = new Date(y, m - 1, d).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (info.state === 'expired') {
      return info.days === 0 ? 'Expired today' : `Expired ${info.days}d ago`;
    }
    if (info.state === 'expiring') {
      return info.days === 0 ? 'Expires today' : `Expires in ${info.days}d`;
    }
    return `Expires ${pretty}`;
  })();

  const showNotes = () =>
    presentAlert({ header: 'Notes', message: doc.notes, buttons: ['Close'] });

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
    } catch (e) {
      toastError('Download failed', e);
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
        presentToast({ message: 'File downloaded — attach it in WhatsApp.', duration: 2500 });
      }
    } catch (e) {
      toastError('Share failed', e);
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
        const newPart = await service.addPart(doc.id, {
          label,
          filename: suggestFilename(label, file),
          blob: file,
        });
        setDoc({ ...doc, parts: [...doc.parts, newPart] });
        setActive(doc.parts.length);
        invalidateForParent(doc.parentId);
      } catch (e) {
        toastError('Could not add the page', e);
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

  const openMove = async () => {
    const rootId = await service.ensureRoot();
    setMoveFromKey(doc.parentId === rootId ? ROOT_KEY : doc.parentId);
    setMoveOpen(true);
  };

  const deleteDocument = async () => {
    try {
      const route = await parentRoute();
      await service.deleteDocument(doc.id);
      invalidateForParent(doc.parentId);
      history.replace(route);
    } catch (e) {
      toastError('Delete failed', e);
    }
  };

  // One delete entry point: pick between the current page and the whole doc.
  const onDelete = () => {
    const canDeletePart = part && doc.parts.length > 1;
    presentActionSheet({
      header: canDeletePart ? `Delete from "${doc.title}"` : `Delete "${doc.title}"?`,
      buttons: [
        ...(canDeletePart
          ? [
              {
                text: `Delete this page (${part.label})`,
                role: 'destructive' as const,
                icon: trashOutline,
                handler: async () => {
                  try {
                    await service.deletePart(part.id);
                    setDoc({ ...doc, parts: doc.parts.filter((p) => p.id !== part.id) });
                    setActive((i) => Math.max(0, i - 1));
                    invalidateForParent(doc.parentId);
                  } catch (e) {
                    toastError('Delete failed', e);
                  }
                },
              },
            ]
          : []),
        {
          text: 'Delete entire document',
          role: 'destructive',
          icon: trashOutline,
          handler: () => void deleteDocument(),
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
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
            <IonButton onClick={openAddPart} aria-label="Add page">
              <IonIcon slot="icon-only" icon={addOutline} />
            </IonButton>
            <IonButton onClick={() => setEditOpen(true)} aria-label="Edit details">
              <IonIcon slot="icon-only" icon={createOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      {/* NOT fullscreen: fullscreen slides content under the translucent
          header, hiding the part tabs and meta chips. */}
      <IonContent scrollY={false} className="detail">
        <div className="detail__layout">
          {(expiryLabel || doc.notes) && (
            <div className="detail__meta">
              {expiryLabel && info && (
                <span className={`detail__chip detail__chip--${info.state}`}>
                  <IonIcon icon={timeOutline} />
                  {expiryLabel}
                </span>
              )}
              {doc.notes && (
                <button className="detail__chip detail__chip--notes" onClick={showNotes}>
                  <IonIcon icon={documentTextOutline} />
                  Notes
                </button>
              )}
            </div>
          )}

          {doc.parts.length === 0 && (
            <div className="detail__none">
              <p>This document has no pages.</p>
              <IonButton onClick={openAddPart}>
                <IonIcon slot="start" icon={addOutline} />
                Add a page
              </IonButton>
            </div>
          )}

          {doc.parts.length > 1 && (
            <div className="detail__tabs">
              {doc.parts.map((p, i) => (
                <button
                  key={p.id}
                  className={`detail__tab ${i === safeActive ? 'active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <div className="detail__stage">
            {part && <PartViewer key={part.id} part={part} />}
          </div>
        </div>
      </IonContent>

      <IonToolbar className="detail__actions">
        <div className="detail__actionbar detail__actionbar--five">
          <button onClick={onDownload} disabled={busy || !part}>
            <IonIcon icon={downloadOutline} />
            <span>Download</span>
          </button>
          <button onClick={onShare} disabled={busy || !part}>
            <IonIcon icon={shareSocialOutline} />
            <span>Share</span>
          </button>
          <button onClick={() => void openMove()} disabled={busy}>
            <IonIcon icon={swapHorizontalOutline} />
            <span>Move</span>
          </button>
          <button onClick={() => setExportOpen(true)} disabled={busy}>
            <IonIcon icon={shareOutline} />
            <span>Export</span>
          </button>
          <button className="danger" onClick={onDelete} disabled={busy}>
            <IonIcon icon={trashOutline} />
            <span>Delete</span>
          </button>
        </div>
      </IonToolbar>

      <EditDetailsModal
        isOpen={editOpen}
        doc={doc}
        onDidDismiss={() => setEditOpen(false)}
        onSave={async (title, meta) => {
          if (title !== doc.title) await service.renameDocument(doc.id, title);
          await service.updateDocumentMeta(doc.id, meta);
          setDoc({
            ...doc,
            title,
            expiresAt: meta.expiresAt,
            remindDays: meta.remindDays,
            notes: meta.notes,
          });
          invalidateForParent(doc.parentId);
        }}
      />

      <ExportSheet
        isOpen={exportOpen}
        source={exportOpen ? { kind: 'doc', id: doc.id } : null}
        onDidDismiss={() => setExportOpen(false)}
      />

      <MoveTargetModal
        isOpen={moveOpen}
        movingId={doc.id}
        movingName={doc.title}
        fromKey={moveFromKey}
        onDidDismiss={() => setMoveOpen(false)}
        onMoved={async (toKey) => {
          const rootId = await service.ensureRoot();
          invalidateForParent(doc.parentId);
          invalidateLevel(toKey);
          setDoc({ ...doc, parentId: toKey === ROOT_KEY ? rootId : toKey });
          presentToast({ message: 'Moved.', duration: 1500 });
        }}
      />
    </IonPage>
  );
}
