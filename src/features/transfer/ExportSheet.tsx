import { useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonList,
  IonModal,
  IonNote,
  IonProgressBar,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import {
  checkmarkCircle,
  closeOutline,
  downloadOutline,
  lockClosedOutline,
  shareSocialOutline,
} from 'ionicons/icons';
import { transfer } from '../../services/vault';
import type { ExportSource } from '../../services/transferService';
import { downloadFile } from '../share/share';
import { logger } from '../../services/logger';
import './transfer.css';

interface Props {
  isOpen: boolean;
  /** What to bundle; null while closed. */
  source: ExportSource | null;
  onDidDismiss: () => void;
}

interface ReadyBundle {
  blob: Blob;
  filename: string;
}

/**
 * Export a vault/group/document as a single .zip (or password-sealed .dvault).
 *
 * Two phases on purpose: the bundle is built first, THEN the user taps
 * "Share" — navigator.share() only works inside a user gesture, so calling it
 * after the (slow, async) build throws "Permission denied" on Android.
 */
export default function ExportSheet({ isOpen, source, onDidDismiss }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [ready, setReady] = useState<ReadyBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setConfirm('');
    setBusy(false);
    setProgress(null);
    setReady(null);
    setError(null);
  }, [isOpen]);

  const mismatch = password.length > 0 && password !== confirm;

  const prepare = async () => {
    if (!source || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const bundle = await transfer.buildExport(source, {
        password: password || undefined,
        onProgress: (done, total) => setProgress([done, total]),
      });
      setReady(bundle);
    } catch (e) {
      logger.error('Export failed', e as Error);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const asFile = (b: ReadyBundle) =>
    new File([b.blob], b.filename, { type: b.blob.type || 'application/octet-stream' });

  const shareSupported =
    ready !== null &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [asFile(ready)] });

  // Runs directly inside the tap handler — keeps the user-gesture context.
  const shareNow = async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: [asFile(ready)], title: 'Document Vault export' });
      presentToast({ message: 'Export shared.', duration: 2000 });
      onDidDismiss();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user closed the sheet
      logger.error('Share failed', e as Error);
      // Fall back to a plain download so the bundle is never lost.
      downloadFile({ filename: ready.filename, mimeType: ready.blob.type, blob: ready.blob });
      presentToast({ message: 'Share unavailable — file downloaded instead.', duration: 2500 });
      onDidDismiss();
    }
  };

  const saveNow = () => {
    if (!ready) return;
    downloadFile({ filename: ready.filename, mimeType: ready.blob.type, blob: ready.blob });
    presentToast({ message: 'Export saved.', duration: 2000 });
    onDidDismiss();
  };

  const prettySize = (bytes: number) =>
    bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  const title =
    source?.kind === 'group' ? `Export “${source.name}”` :
    source?.kind === 'doc' ? 'Export document' :
    'Back up everything';

  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={onDidDismiss}
      initialBreakpoint={0.75}
      breakpoints={[0, 0.75, 1]}
    >
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onDidDismiss} disabled={busy}>
              <IonIcon slot="icon-only" icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>{title}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {ready ? (
          <>
            <div className="transfer-ready">
              <IonIcon icon={checkmarkCircle} />
              <div>
                <strong>Your bundle is ready</strong>
                <small>
                  {ready.filename} · {prettySize(ready.blob.size)}
                  {password ? ' · encrypted' : ''}
                </small>
              </div>
            </div>

            {shareSupported && (
              <IonButton expand="block" className="transfer-cta" onClick={() => void shareNow()}>
                <IonIcon slot="start" icon={shareSocialOutline} />
                Share…
              </IonButton>
            )}
            <IonButton
              expand="block"
              fill={shareSupported ? 'outline' : 'solid'}
              className={shareSupported ? '' : 'transfer-cta'}
              onClick={saveNow}
            >
              <IonIcon slot="start" icon={downloadOutline} />
              Save file
            </IonButton>
          </>
        ) : (
          <>
            <p className="transfer-blurb">
              Bundles everything into a single file you can save or send to someone —
              they can import it into their own vault. Files keep their original quality.
            </p>

            <IonList inset>
              <IonItem>
                <IonInput
                  label="Password (optional)"
                  labelPlacement="stacked"
                  type="password"
                  placeholder="Leave empty for a plain zip"
                  value={password}
                  onIonInput={(e) => setPassword(e.detail.value ?? '')}
                  disabled={busy}
                />
              </IonItem>
              {password && (
                <IonItem>
                  <IonInput
                    label="Confirm password"
                    labelPlacement="stacked"
                    type="password"
                    value={confirm}
                    onIonInput={(e) => setConfirm(e.detail.value ?? '')}
                    disabled={busy}
                  />
                </IonItem>
              )}
            </IonList>
            {password ? (
              <IonNote className="transfer-note">
                <IonIcon icon={lockClosedOutline} />
                Encrypted — the file can only be opened with this password. There is no
                way to recover it if forgotten.
              </IonNote>
            ) : (
              <IonNote className="transfer-note">
                The file is not encrypted — anyone holding it can open your documents.
                Set a password before sharing sensitive documents.
              </IonNote>
            )}
            {mismatch && <p className="transfer-error">Passwords don’t match.</p>}
            {error && <p className="transfer-error">{error}</p>}

            {busy && (
              <div className="transfer-progress">
                <IonProgressBar
                  value={progress && progress[1] > 0 ? progress[0] / progress[1] : undefined}
                  type={progress ? 'determinate' : 'indeterminate'}
                />
                <span>
                  {progress ? `Preparing ${progress[0]} of ${progress[1]} files…` : 'Preparing…'}
                </span>
              </div>
            )}

            <IonButton
              expand="block"
              className="transfer-cta"
              disabled={busy || mismatch}
              onClick={() => void prepare()}
            >
              {busy ? <IonSpinner name="crescent" /> : 'Prepare export'}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
