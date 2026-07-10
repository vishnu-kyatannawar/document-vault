import { useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonList,
  IonModal,
  IonProgressBar,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import {
  chevronBackOutline,
  chevronForward,
  closeOutline,
  documentAttachOutline,
  folderOpenOutline,
  homeOutline,
} from 'ionicons/icons';
import { ROOT_KEY, useDocumentsStore } from '../../store/documentsStore';
import { documents as service, transfer } from '../../services/vault';
import { isEncrypted } from '../../services/crypto';
import { VaultGroup } from '../../services/documentsService';
import { logger } from '../../services/logger';
import '../documents/MoveTargetModal.css';
import './transfer.css';

interface Crumb {
  key: string; // ROOT_KEY or group id
  name: string;
}

interface Props {
  isOpen: boolean;
  onDidDismiss: () => void;
}

/** Pick a bundle file + destination group, then rebuild the tree there. */
export default function ImportModal({ isOpen, onDidDismiss }: Props) {
  const invalidateLevel = useDocumentsStore((s) => s.invalidateLevel);
  const [trail, setTrail] = useState<Crumb[]>([{ key: ROOT_KEY, name: 'Home' }]);
  const [groups, setGroups] = useState<VaultGroup[] | null>(null);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [presentToast] = useIonToast();

  const current = trail[trail.length - 1];
  const encrypted = file ? isEncrypted(file.bytes) : false;

  useEffect(() => {
    if (!isOpen) return;
    setTrail([{ key: ROOT_KEY, name: 'Home' }]);
    setFile(null);
    setPassword('');
    setBusy(false);
    setProgress(null);
    setError(null);
  }, [isOpen]);

  // Browse groups for the destination (same pattern as MoveTargetModal).
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setGroups(null);
    service
      .listLevel(current.key === ROOT_KEY ? undefined : current.key)
      .then((level) => active && setGroups(level.groups))
      .catch(() => active && setGroups([]));
    return () => {
      active = false;
    };
  }, [isOpen, current.key]);

  const pickFile = () => inputRef.current?.click();

  const onFileChosen = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setPassword('');
    try {
      setFile({ name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) });
    } catch (e) {
      logger.error('Bundle read failed', e as Error);
      setError('Could not read that file.');
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await transfer.applyImport(file.bytes, {
        password: password || undefined,
        destParentId: current.key === ROOT_KEY ? undefined : current.key,
        onProgress: (done, total) => setProgress([done, total]),
      });
      invalidateLevel(current.key);
      if (result.failedAt) {
        setError(
          `Imported ${result.imported} of ${result.total} — failed at “${result.failedAt}”` +
            (result.error ? ` (${result.error})` : '') +
            '. Already-imported items were kept; you can retry the rest.',
        );
        setBusy(false);
        return;
      }
      presentToast({
        message: `Imported ${result.imported} document${result.imported === 1 ? '' : 's'} into ${current.name}.`,
        duration: 2500,
      });
      onDidDismiss();
    } catch (e) {
      logger.error('Import failed', e as Error);
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDidDismiss}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            {trail.length > 1 ? (
              <IonButton onClick={() => setTrail((t) => t.slice(0, -1))} disabled={busy}>
                <IonIcon slot="icon-only" icon={chevronBackOutline} />
              </IonButton>
            ) : (
              <IonButton onClick={onDidDismiss} disabled={busy}>
                <IonIcon slot="icon-only" icon={closeOutline} />
              </IonButton>
            )}
          </IonButtons>
          <IonTitle>Import backup</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Mobile pickers often ignore custom extensions; bytes are sniffed after pick. */}
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.dvault,application/zip,application/octet-stream"
          hidden
          onChange={(e) => {
            void onFileChosen(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <button className="transfer-filepick" onClick={pickFile} disabled={busy}>
          <IonIcon icon={documentAttachOutline} />
          <span>{file ? file.name : 'Choose a backup file (.zip / .dvault)'}</span>
        </button>

        {encrypted && (
          <IonList inset>
            <IonItem>
              <IonInput
                label="Bundle password"
                labelPlacement="stacked"
                type="password"
                value={password}
                onIonInput={(e) => setPassword(e.detail.value ?? '')}
                disabled={busy}
              />
            </IonItem>
          </IonList>
        )}

        {error && <p className="transfer-error">{error}</p>}

        {busy && (
          <div className="transfer-progress">
            <IonProgressBar
              value={progress && progress[1] > 0 ? progress[0] / progress[1] : undefined}
              type={progress ? 'determinate' : 'indeterminate'}
            />
            <span>
              {progress
                ? `Importing ${progress[0]} of ${progress[1]} documents…`
                : 'Reading bundle…'}
            </span>
          </div>
        )}

        <p className="transfer-blurb">Where should it go?</p>
        <div className="move-crumbs">
          <IonIcon icon={homeOutline} />
          {trail.map((c, i) => (
            <span key={c.key} className={i === trail.length - 1 ? 'active' : ''}>
              {i > 0 && ' / '}
              {c.name}
            </span>
          ))}
        </div>

        {groups === null ? (
          <div className="move-center">
            <IonSpinner name="crescent" />
          </div>
        ) : groups.length === 0 ? (
          <p className="move-empty">No subgroups here.</p>
        ) : (
          <div className="group-list">
            {groups.map((g) => (
              <div
                className="group-row"
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => !busy && setTrail((t) => [...t, { key: g.id, name: g.name }])}
                onKeyDown={(e) =>
                  e.key === 'Enter' && setTrail((t) => [...t, { key: g.id, name: g.name }])
                }
              >
                <span className="group-row__icon">
                  <IonIcon icon={folderOpenOutline} />
                </span>
                <span className="group-row__name">{g.name}</span>
                <IonIcon className="group-row__chevron" icon={chevronForward} />
              </div>
            ))}
          </div>
        )}
      </IonContent>

      <IonFooter>
        <IonToolbar>
          <IonButton
            expand="block"
            className="move-confirm"
            disabled={busy || !file || (encrypted && !password)}
            onClick={run}
          >
            {busy ? (
              <IonSpinner name="crescent" />
            ) : (
              `Import here (${current.name})`
            )}
          </IonButton>
        </IonToolbar>
      </IonFooter>
    </IonModal>
  );
}
