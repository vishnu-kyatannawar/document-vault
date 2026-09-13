import { useEffect, useState } from 'react';
import {
  IonButton,
  IonIcon,
  IonInput,
  IonModal,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  useIonToast,
} from '@ionic/react';
import {
  closeOutline,
  informationCircleOutline,
  peopleOutline,
  personAddOutline,
} from 'ionicons/icons';
import { documents as service } from '../../services/vault';
import type { ShareLevel, SharePerson } from '../../services/documentsService';
import { logger } from '../../services/logger';
import './SharePeopleSheet.css';

interface Props {
  isOpen: boolean;
  /** Folder (group or document) to share; null while closed. */
  target: { id: string; name: string } | null;
  onDidDismiss: () => void;
}

/**
 * Share a group/document folder with other Google accounts, live and
 * read-only: one copy stays in the owner's Drive, recipients see the current
 * files under "Shared with me" in their own app. Backed by Drive permissions.
 */
export default function SharePeopleSheet({ isOpen, target, onDidDismiss }: Props) {
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [level, setLevel] = useState<ShareLevel>('download');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presentToast] = useIonToast();

  useEffect(() => {
    if (!isOpen || !target) return;
    let active = true;
    setPeople([]);
    setEmail('');
    setError(null);
    setLoading(true);
    service
      .getSharing(target.id)
      .then((s) => {
        if (!active) return;
        setPeople(s.people);
        setLevel(s.level);
      })
      .catch((e) => {
        logger.error('Load sharing failed', e as Error);
        if (active) setError((e as Error).message);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [isOpen, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!target || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const person = await service.shareWith(target.id, email);
      setPeople((list) =>
        list.some((p) => p.email === person.email) ? list : [...list, person],
      );
      setEmail('');
      presentToast({ message: `Shared with ${person.email}.`, duration: 2000 });
    } catch (e) {
      logger.error('Share failed', e as Error);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person: SharePerson) => {
    if (!target) return;
    setBusy(true);
    try {
      await service.unshare(target.id, person.permissionId);
      setPeople((list) => list.filter((p) => p.permissionId !== person.permissionId));
    } catch (e) {
      logger.error('Unshare failed', e as Error);
      presentToast({ message: `Could not remove: ${(e as Error).message}`, duration: 3000 });
    } finally {
      setBusy(false);
    }
  };

  const changeLevel = async (next: ShareLevel) => {
    if (!target || next === level) return;
    const previous = level;
    setLevel(next);
    try {
      await service.setShareLevel(target.id, next);
    } catch (e) {
      logger.error('Share level change failed', e as Error);
      setLevel(previous);
      presentToast({ message: `Could not change access: ${(e as Error).message}`, duration: 3000 });
    }
  };

  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={onDidDismiss}
      initialBreakpoint={0.75}
      breakpoints={[0, 0.75, 1]}
      className="share-sheet"
    >
      <div className="share-sheet__body">
        <div className="share-sheet__header">
          <span className="share-sheet__icon">
            <IonIcon icon={peopleOutline} />
          </span>
          <div>
            <h2>Share “{target?.name}”</h2>
            <p>One copy, always current — they see updates as you make them.</p>
          </div>
        </div>

        <IonSegment
          value={level}
          disabled={loading || busy}
          onIonChange={(e) => void changeLevel(e.detail.value as ShareLevel)}
          className="share-sheet__level"
        >
          <IonSegmentButton value="download">Can view &amp; download</IonSegmentButton>
          <IonSegmentButton value="view">View in Google Drive only</IonSegmentButton>
        </IonSegment>
        <p className="share-sheet__hint">
          {level === 'download'
            ? 'They can view pages in the app, download, and share them on. Never edit or delete.'
            : 'They can only open pages inside Google Drive — no download, copy or print. In-app preview is unavailable to them.'}
        </p>

        <form
          className="share-sheet__add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <IonInput
            value={email}
            type="email"
            inputmode="email"
            autocapitalize="off"
            placeholder="Their Google account email"
            onIonInput={(e) => setEmail(e.detail.value ?? '')}
            disabled={busy}
            fill="outline"
          />
          <IonButton type="submit" disabled={busy || !email.trim()}>
            {busy ? <IonSpinner name="crescent" /> : <IonIcon slot="icon-only" icon={personAddOutline} />}
          </IonButton>
        </form>
        {error && <p className="share-sheet__error">{error}</p>}

        <div className="share-sheet__people">
          {loading ? (
            <div className="share-sheet__center">
              <IonSpinner name="crescent" />
            </div>
          ) : people.length === 0 ? (
            <p className="share-sheet__empty">Not shared with anyone yet.</p>
          ) : (
            people.map((p) => (
              <div className="share-sheet__person" key={p.permissionId}>
                <span className="share-sheet__avatar">{(p.name || p.email)[0]?.toUpperCase()}</span>
                <span className="share-sheet__who">
                  <strong>{p.name || p.email}</strong>
                  {p.name && <small>{p.email}</small>}
                </span>
                <button
                  aria-label={`Remove ${p.email}`}
                  onClick={() => void remove(p)}
                  disabled={busy}
                >
                  <IonIcon icon={closeOutline} />
                </button>
              </div>
            ))
          )}
        </div>

        <p className="share-sheet__note">
          <IonIcon icon={informationCircleOutline} />
          They sign in to Document Vault with that Google account and find it under
          “Shared with me”. Google also emails them a link.
        </p>
      </div>
    </IonModal>
  );
}
