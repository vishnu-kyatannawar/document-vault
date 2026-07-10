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
import { closeOutline, lockClosedOutline } from 'ionicons/icons';
import { transfer } from '../../services/vault';
import type { ExportSource } from '../../services/transferService';
import { shareOrDownload } from '../share/share';
import { logger } from '../../services/logger';
import './transfer.css';

interface Props {
  isOpen: boolean;
  /** What to bundle; null while closed. */
  source: ExportSource | null;
  onDidDismiss: () => void;
}

/** Export a vault/group/document as a single .zip (or password-sealed .dvault). */
export default function ExportSheet({ isOpen, source, onDidDismiss }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setConfirm('');
    setBusy(false);
    setProgress(null);
    setError(null);
  }, [isOpen]);

  const mismatch = password.length > 0 && password !== confirm;

  const run = async () => {
    if (!source || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await transfer.buildExport(source, {
        password: password || undefined,
        onProgress: (done, total) => setProgress([done, total]),
      });
      const outcome = await shareOrDownload(
        { filename, mimeType: blob.type, blob },
        'Document Vault export',
      );
      presentToast({
        message: outcome === 'shared' ? 'Export shared.' : 'Export downloaded.',
        duration: 2000,
      });
      onDidDismiss();
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // User closed the share sheet — the bundle was built fine.
        onDidDismiss();
        return;
      }
      logger.error('Export failed', e as Error);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
          onClick={run}
        >
          {busy ? <IonSpinner name="crescent" /> : 'Export'}
        </IonButton>
      </IonContent>
    </IonModal>
  );
}
